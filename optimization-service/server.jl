using HTTP, JSON3, JuMP, HiGHS
import MathOptInterface as MOI

const PORT = parse(Int, get(ENV, "JULIA_PORT", "3002"))

# Formation targets per match type
const POSITIONS_7      = ["GK", "DEF", "WIN", "MID", "STR"]
const FORMATION_7      = Dict("GK" => 1, "DEF" => 2, "WIN" => 2, "MID" => 1, "STR" => 1)
const POSITIONS_FUTSAL = ["GK", "WIN", "MID", "STR"]
const FORMATION_FUTSAL = Dict("GK" => 1, "WIN" => 2, "MID" => 1, "STR" => 1)

# Objective weights
const W_FAIRNESS  = 0.9    # played vs signed-up fairness
const W_DEFICIT   = 15.0   # penalty per missing player below target
const W_POSITION  = -1.0   # reward per covered formation slot
const W_WINGER    = -0.5   # extra reward for covering both winger slots
const R_PRIORITY  = -1.0   # reward for including a priority player

struct Player
    id            :: String
    name          :: String
    preferred     :: Vector{String}
    games_played  :: Int
    games_signedup:: Int
    is_priority   :: Bool
end

struct OptimizeRequest
    match_id        :: String
    match_type      :: String    # "futsal", "7-player", "11-player"
    target_players  :: Int       # min_players
    max_players     :: Int
    total_matches   :: Int       # historical total for fairness metric
    fairness_weight :: Float64   # 0 = positions only, 1 = fairness only (default 0.5)
    players         :: Vector{Player}
end

function parse_request(body::Vector{UInt8}) :: OptimizeRequest
    d = JSON3.read(body)

    players = Player[
        Player(
            string(p.id),
            string(p.name),
            String[string(pos) for pos in p.preferred_positions],
            Int(p.games_played),
            Int(p.games_signedup),
            Bool(p.is_priority),
        )
        for p in d.players
    ]

    OptimizeRequest(
        string(d.match_id),
        string(get(d, :match_type, "7-player")),
        Int(d.target_players),
        Int(d.max_players),
        Int(get(d, :total_matches, 15)),
        Float64(clamp(get(d, :fairness_weight, 0.5), 0.0, 1.0)),
        players,
    )
end

function optimize(req :: OptimizeRequest)
    n = length(req.players)
    if n == 0
        return Dict("error" => "No players signed up")
    end

    is_futsal   = req.match_type == "futsal"
    positions   = is_futsal ? POSITIONS_FUTSAL : POSITIONS_7
    formation   = is_futsal ? FORMATION_FUTSAL : FORMATION_7

    # For futsal, only GK preference is used; outfield players are selected on fairness.
    effective_prefs = if is_futsal
        [filter(p -> p == "GK", player.preferred) for player in req.players]
    else
        [player.preferred for player in req.players]
    end

    total  = max(req.total_matches, 1)
    α      = req.fairness_weight          # 0 = positions only, 1 = fairness only
    w_fair = 2.0 * α                      # 0→0, 0.5→1 (default), 1→2
    w_pos  = 2.0 * (1.0 - α)             # 1→2, 0.5→1 (default), 0→0

    # Fairness measure: higher = more games played relative to sign-ups → costlier to select
    measure = [
        (W_FAIRNESS * p.games_played - (1 - W_FAIRNESS) * p.games_signedup) / total
        for p in req.players
    ]

    priority_idx = [i for (i, p) in enumerate(req.players) if p.is_priority]

    model = Model(HiGHS.Optimizer)
    set_silent(model)

    @variable(model, x[1:n], Bin)                          # selected?
    @variable(model, y[1:n], Bin)                          # priority & selected?
    @variable(model, d >= 0, Int)                          # deficit below target
    @variable(model, pos_covered[p=positions], Bin)        # formation slot met?

    @objective(model, Min,
        w_fair * sum(measure[i] * x[i] for i in 1:n)
        + W_DEFICIT * d
        + R_PRIORITY * sum(y[i] for i in priority_idx)
        + w_pos * W_POSITION * sum(pos_covered[p] for p in positions)
        + w_pos * W_WINGER * pos_covered["WIN"]
    )

    @constraint(model, sum(x[i] for i in 1:n) + d == req.target_players)
    @constraint(model, sum(x[i] for i in 1:n) <= req.max_players)

    for i in 1:n
        @constraint(model, y[i] <= x[i])
    end
    for i in setdiff(1:n, priority_idx)
        fix(y[i], 0; force=true)
    end

    for pos in positions
        eligible = [i for (i, prefs) in enumerate(effective_prefs) if pos in prefs]
        if isempty(eligible)
            fix(pos_covered[pos], 0; force=true)
        else
            @constraint(model,
                formation[pos] * pos_covered[pos] <= sum(x[i] for i in eligible)
            )
        end
    end

    optimize!(model)

    status = termination_status(model)
    if status != MOI.OPTIMAL && status != MOI.FEASIBLE_POINT
        return Dict(
            "status"  => string(status),
            "error"   => "Solver did not find an optimal solution",
        )
    end

    selected = [req.players[i].id for i in 1:n if value(x[i]) > 0.9]
    result_formation = Dict(
        pos => Dict(
            "covered"  => value(pos_covered[pos]) > 0.9,
            "required" => formation[pos],
            "filled"   => Int(round(sum(
                value(x[i]) for (i, prefs) in enumerate(effective_prefs) if pos in prefs;
                init=0.0,
            ))),
        )
        for pos in positions
    )

    return Dict(
        "status"        => string(status),
        "objective"     => round(objective_value(model); digits=4),
        "deficit"       => Int(round(value(d))),
        "selected_ids"  => selected,
        "formation"     => result_formation,
        "solve_time_ms" => round(solve_time(model) * 1000; digits=1),
    )
end

function handle(req :: HTTP.Request)
    if req.method == "GET" && req.target == "/health"
        return HTTP.Response(200, ["Content-Type" => "application/json"],
            JSON3.write(Dict("status" => "ok")))
    end

    if req.method != "POST" || req.target != "/optimize"
        return HTTP.Response(404, ["Content-Type" => "application/json"],
            JSON3.write(Dict("error" => "Not found")))
    end

    try
        parsed = parse_request(req.body)
        result = optimize(parsed)
        status_code = haskey(result, "error") && !haskey(result, "selected_ids") ? 422 : 200
        return HTTP.Response(status_code, ["Content-Type" => "application/json"],
            JSON3.write(result))
    catch e
        @error "Optimization error" exception=(e, catch_backtrace())
        return HTTP.Response(500, ["Content-Type" => "application/json"],
            JSON3.write(Dict("error" => string(e))))
    end
end

@info "Boca optimizer listening on port $PORT"
HTTP.serve(handle, "0.0.0.0", PORT)
