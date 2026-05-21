using HTTP, JSON3, JuMP, HiGHS
import MathOptInterface as MOI

const PORT = parse(Int, get(ENV, "JULIA_PORT", "3002"))

# Formation targets (7-player futsal/small-sided)
const POSITIONS       = ["GK", "DEF", "WIN", "MID", "STR"]
const FORMATION_MIN   = Dict("GK" => 1, "DEF" => 2, "WIN" => 2, "MID" => 1, "STR" => 1)

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
    match_id       :: String
    target_players :: Int   # min_players (antalUdtagede)
    max_players    :: Int
    total_matches  :: Int   # historical total for fairness metric
    players        :: Vector{Player}
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
        Int(d.target_players),
        Int(d.max_players),
        Int(get(d, :total_matches, 15)),
        players,
    )
end

function optimize(req :: OptimizeRequest)
    n = length(req.players)
    if n == 0
        return Dict("error" => "No players signed up")
    end

    total = max(req.total_matches, 1)

    # Fairness measure: higher = more games played relative to sign-ups → costlier to select
    measure = [
        (W_FAIRNESS * p.games_played - (1 - W_FAIRNESS) * p.games_signedup) / total
        for p in req.players
    ]

    priority_idx = [i for (i, p) in enumerate(req.players) if p.is_priority]

    model = Model(HiGHS.Optimizer)
    set_silent(model)

    @variable(model, x[1:n], Bin)                        # selected?
    @variable(model, y[1:n], Bin)                        # priority & selected?
    @variable(model, d >= 0, Int)                        # deficit below target
    @variable(model, pos_covered[p=POSITIONS], Bin)      # formation slot met?

    @objective(model, Min,
        sum(measure[i] * x[i] for i in 1:n)
        + W_DEFICIT * d
        + R_PRIORITY * sum(y[i] for i in priority_idx)
        + W_POSITION * sum(pos_covered[p] for p in POSITIONS)
        + W_WINGER * pos_covered["WIN"]
    )

    # All players are already signed up — no A matrix needed
    @constraint(model, sum(x[i] for i in 1:n) + d == req.target_players)
    @constraint(model, sum(x[i] for i in 1:n) <= req.max_players)

    for i in 1:n
        @constraint(model, y[i] <= x[i])
    end
    for i in setdiff(1:n, priority_idx)
        fix(y[i], 0; force=true)
    end

    for pos in POSITIONS
        eligible = [i for (i, p) in enumerate(req.players) if pos in p.preferred]
        if isempty(eligible)
            fix(pos_covered[pos], 0; force=true)
        else
            @constraint(model,
                FORMATION_MIN[pos] * pos_covered[pos] <= sum(x[i] for i in eligible)
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
    formation = Dict(
        pos => Dict(
            "covered"  => value(pos_covered[pos]) > 0.9,
            "required" => FORMATION_MIN[pos],
            "filled"   => Int(round(sum(
                value(x[i]) for (i, p) in enumerate(req.players) if pos in p.preferred;
                init=0.0,
            ))),
        )
        for pos in POSITIONS
    )

    return Dict(
        "status"        => string(status),
        "objective"     => round(objective_value(model); digits=4),
        "deficit"       => Int(round(value(d))),
        "selected_ids"  => selected,
        "formation"     => formation,
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
