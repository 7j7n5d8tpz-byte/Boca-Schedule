using HTTP, JSON3, JuMP, HiGHS
import MathOptInterface as MOI

const PORT = parse(Int, get(ENV, "JULIA_PORT", "3002"))

# Formation targets per match type
const POSITIONS_7      = ["GK", "DEF", "WIN", "MID", "STR"]
const FORMATION_7      = Dict("GK" => 1, "DEF" => 2, "WIN" => 2, "MID" => 1, "STR" => 1)
const POSITIONS_FUTSAL = ["GK", "WIN", "MID", "STR"]
const FORMATION_FUTSAL = Dict("GK" => 1, "WIN" => 2, "MID" => 1, "STR" => 1)

# Objective weights
const W_FAIRNESS  = 0.8    # fairness blend: games played vs sign-ups, weighted 4:1.
                           # Selection cost = (0.8·played − 0.2·signed_up)/total, so
                           # games actually played dominate, while regular sign-ups
                           # earn a meaningful secondary reward (the loyal-but-benched
                           # get picked sooner). Raise toward 1.0 to equalise pure game
                           # counts; lower toward 0.5 to weight attendance more.
const W_DEFICIT   = 15.0   # penalty per missing player below target
const W_POSITION  = -1.0   # reward per covered formation slot
const W_WINGER    = -0.5   # extra reward for covering both winger slots
const R_PRIORITY  = -1.0   # reward for including a priority player

# ─── Single-match types ───────────────────────────────────────────────────────

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

# ─── Batch types ─────────────────────────────────────────────────────────────

struct BatchSignup
    player_id   :: String
    is_priority :: Bool
end

struct BatchMatchSpec
    match_id        :: String
    match_type      :: String
    target_players  :: Int
    max_players     :: Int
    fairness_weight :: Float64
    signups         :: Vector{BatchSignup}
end

struct BatchPlayer
    id             :: String
    name           :: String
    preferred      :: Vector{String}
    games_played   :: Int
    games_signedup :: Int
end

struct BatchOptimizeRequest
    total_matches :: Int
    players       :: Vector{BatchPlayer}
    matches       :: Vector{BatchMatchSpec}
end

function parse_batch_request(body::Vector{UInt8}) :: BatchOptimizeRequest
    d = JSON3.read(body)

    players = BatchPlayer[
        BatchPlayer(
            string(p.id),
            string(p.name),
            String[string(pos) for pos in p.preferred_positions],
            Int(p.games_played),
            Int(p.games_signedup),
        )
        for p in d.players
    ]

    matches = BatchMatchSpec[
        BatchMatchSpec(
            string(m.match_id),
            string(get(m, :match_type, "7-player")),
            Int(m.target_players),
            Int(m.max_players),
            Float64(clamp(get(m, :fairness_weight, 0.5), 0.0, 1.0)),
            BatchSignup[
                BatchSignup(string(s.player_id), Bool(s.is_priority))
                for s in m.signups
            ],
        )
        for m in d.matches
    ]

    BatchOptimizeRequest(
        Int(get(d, :total_matches, 15)),
        players,
        matches,
    )
end

# ─── Batch optimizer ─────────────────────────────────────────────────────────
#
# Builds one MIP across all M matches. Variables x[m,i] are indexed by
# (match index, local signup index within that match). The fairness terms
# from all matches share the same player measure values — so selecting a
# high-load player for match A raises his contribution in match B's terms
# too, coupling the decisions without any quadratic terms.

function optimize_batch(req::BatchOptimizeRequest)
    M = length(req.matches)
    P = length(req.players)

    if M == 0
        return Dict("error" => "No matches provided")
    end
    if P == 0
        return Dict("error" => "No players provided")
    end

    player_id_to_idx = Dict(req.players[i].id => i for i in 1:P)
    total = max(req.total_matches, 1)

    # Historical fairness measure per player (fixed across all matches)
    measure = [
        (W_FAIRNESS * p.games_played - (1.0 - W_FAIRNESS) * p.games_signedup) / total
        for p in req.players
    ]

    # Per-match precomputed data
    signups_global    = Vector{Vector{Int}}(undef, M)          # global player index per signup slot
    priority_local    = Vector{Vector{Int}}(undef, M)          # local signup indices that are priority
    eff_prefs         = Vector{Vector{Vector{String}}}(undef, M)
    positions_m       = Vector{Vector{String}}(undef, M)
    formation_m       = Vector{Dict{String,Int}}(undef, M)

    for m in 1:M
        spec      = req.matches[m]
        is_futsal = spec.match_type == "futsal"
        positions_m[m] = is_futsal ? POSITIONS_FUTSAL : POSITIONS_7
        formation_m[m] = is_futsal ? FORMATION_FUTSAL : FORMATION_7

        gidxs = Int[]
        prio  = Int[]
        prefs = Vector{String}[]

        for su in spec.signups
            gi = get(player_id_to_idx, su.player_id, 0)
            gi == 0 && continue
            push!(gidxs, gi)
            li = length(gidxs)
            su.is_priority && push!(prio, li)
            raw = req.players[gi].preferred
            push!(prefs, is_futsal ? filter(p -> p == "GK", raw) : raw)
        end

        if isempty(gidxs)
            return Dict("error" => "Match $(spec.match_id) has no valid sign-ups")
        end

        signups_global[m] = gidxs
        priority_local[m] = prio
        eff_prefs[m]       = prefs
    end

    model = Model(HiGHS.Optimizer)
    set_silent(model)

    # Build variable dicts keyed by (match_idx, local_idx)
    x       = Dict{Tuple{Int,Int}, VariableRef}()
    y       = Dict{Tuple{Int,Int}, VariableRef}()
    d       = Vector{VariableRef}(undef, M)
    pos_cov = Dict{Tuple{Int,String}, VariableRef}()

    for m in 1:M
        n_m = length(signups_global[m])
        for li in 1:n_m
            x[(m, li)] = @variable(model, binary=true, base_name="x_$(m)_$(li)")
        end
        d[m] = @variable(model, lower_bound=0, base_name="d_$m")
        for pos in positions_m[m]
            pos_cov[(m, pos)] = @variable(model, binary=true, base_name="pc_$(m)_$(pos)")
        end
        for li in priority_local[m]
            y[(m, li)] = @variable(model, binary=true, base_name="y_$(m)_$(li)")
        end
    end

    # Objective: sum of per-match terms.
    # Joint fairness emerges because every time the same player is selected
    # across matches their accumulated measure cost grows in the shared objective.
    obj = AffExpr(0.0)

    for m in 1:M
        spec   = req.matches[m]
        α      = spec.fairness_weight
        w_fair = 2.0 * α
        w_pos  = 2.0 * (1.0 - α)
        n_m    = length(signups_global[m])

        for li in 1:n_m
            gi = signups_global[m][li]
            add_to_expression!(obj, w_fair * measure[gi], x[(m, li)])
        end

        add_to_expression!(obj, W_DEFICIT, d[m])

        for li in priority_local[m]
            add_to_expression!(obj, R_PRIORITY, y[(m, li)])
        end

        for pos in positions_m[m]
            add_to_expression!(obj, w_pos * W_POSITION, pos_cov[(m, pos)])
        end
        if "WIN" in positions_m[m]
            add_to_expression!(obj, w_pos * W_WINGER, pos_cov[(m, "WIN")])
        end

        # Per-match constraints
        @constraint(model, sum(x[(m, li)] for li in 1:n_m) + d[m] == spec.target_players)
        @constraint(model, sum(x[(m, li)] for li in 1:n_m) <= spec.max_players)

        for li in priority_local[m]
            @constraint(model, y[(m, li)] <= x[(m, li)])
        end

        for pos in positions_m[m]
            eligible = [li for li in 1:n_m if pos in eff_prefs[m][li]]
            if isempty(eligible)
                fix(pos_cov[(m, pos)], 0; force=true)
            else
                @constraint(model,
                    formation_m[m][pos] * pos_cov[(m, pos)] <= sum(x[(m, li)] for li in eligible)
                )
            end
        end
    end

    @objective(model, Min, obj)
    optimize!(model)

    status = termination_status(model)
    if status != MOI.OPTIMAL && status != MOI.FEASIBLE_POINT
        return Dict(
            "status" => string(status),
            "error"  => "Solver did not find an optimal solution",
        )
    end

    match_results = []
    for m in 1:M
        spec = req.matches[m]
        n_m  = length(signups_global[m])

        selected_ids = [
            req.players[signups_global[m][li]].id
            for li in 1:n_m
            if value(x[(m, li)]) > 0.9
        ]

        result_formation = Dict(
            pos => Dict(
                "covered"  => value(pos_cov[(m, pos)]) > 0.9,
                "required" => formation_m[m][pos],
                "filled"   => Int(round(sum(
                    value(x[(m, li)])
                    for li in 1:n_m
                    if pos in eff_prefs[m][li];
                    init=0.0,
                ))),
            )
            for pos in positions_m[m]
        )

        push!(match_results, Dict(
            "match_id"     => spec.match_id,
            "selected_ids" => selected_ids,
            "deficit"      => Int(round(value(d[m]))),
            "formation"    => result_formation,
        ))
    end

    return Dict(
        "status"        => string(status),
        "objective"     => round(objective_value(model); digits=4),
        "solve_time_ms" => round(solve_time(model) * 1000; digits=1),
        "matches"       => match_results,
    )
end

# ─── HTTP router ─────────────────────────────────────────────────────────────

function handle(req :: HTTP.Request)
    if req.method == "GET" && req.target == "/health"
        return HTTP.Response(200, ["Content-Type" => "application/json"],
            JSON3.write(Dict("status" => "ok")))
    end

    if req.method == "POST" && req.target == "/optimize"
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

    if req.method == "POST" && req.target == "/optimize/batch"
        try
            parsed = parse_batch_request(req.body)
            result = optimize_batch(parsed)
            status_code = haskey(result, "error") && !haskey(result, "matches") ? 422 : 200
            return HTTP.Response(status_code, ["Content-Type" => "application/json"],
                JSON3.write(result))
        catch e
            @error "Batch optimization error" exception=(e, catch_backtrace())
            return HTTP.Response(500, ["Content-Type" => "application/json"],
                JSON3.write(Dict("error" => string(e))))
        end
    end

    return HTTP.Response(404, ["Content-Type" => "application/json"],
        JSON3.write(Dict("error" => "Not found")))
end

@info "Boca optimizer listening on port $PORT"
HTTP.serve(handle, "0.0.0.0", PORT)
