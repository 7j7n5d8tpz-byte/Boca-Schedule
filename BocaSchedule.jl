using Random, JuMP, HiGHS
import MathOptInterface as MOI

############# Data #################

n             = 20   # Number of players
m             = 4    # Number of matches
p             = 3    # Number of priority players
antalUdtagede = 10   # Target squad size (= min_players in production)
maxSpillere   = 10   # Maximum squad size (= max_players in production)

R          = -1    # Priority reward coefficient (negative = reward)
w          = 0.9   # Fairness weight (played vs signed-up)
w_deficit  = 15.0  # Penalty per missing player (= totalKampe)
w_position = -1.0  # Reward per formation slot covered
w_winger   = -0.5  # Extra reward for covering the second winger

totalKampe = 15
spilledeK  = rand(1:9, n)
tilmeldteK = zeros(Int, n)
for i in 1:n
    tilmeldteK[i] = rand(spilledeK[i]:totalKampe)
end

measure = (w .* spilledeK .- (1 - w) .* tilmeldteK) ./ totalKampe

A             = rand(0:1, (n, m))
priorSpillere = randperm(n)[1:p]

# Positions and formation targets
# Formation: 1 GK, 2 DEF, 2 WIN, 1 MID, 1 STR  (7 players on the field)
positions     = ["GK", "DEF", "WIN", "MID", "STR"]
formation_min = Dict("GK" => 1, "DEF" => 2, "WIN" => 2, "MID" => 1, "STR" => 1)

# Each player's preferred positions (subset of the positions list).
# In production this comes from the database; here we generate random preferences.
Random.seed!(42)
preferredPos = [positions[randperm(length(positions))[1:rand(1:2)]] for _ in 1:n]

######### Model ##############
model = Model(HiGHS.Optimizer)
set_silent(model)

# x[i,j] = 1 if player i is selected for match j
@variable(model, x[i=1:n, j=1:m], Bin)

# y[i,j] = 1 if player i is a priority player selected for match j
@variable(model, y[i=1:n, j=1:m], Bin)

# d[j] = deficit (players short of antalUdtagede) for match j
@variable(model, d[j=1:m] >= 0, Int)

# pos_covered[j,p] = 1 if the formation requirement for position p is fully met in match j,
# i.e. at least formation_min[p] selected players list p as a preferred position.
@variable(model, pos_covered[j=1:m, p=positions], Bin)

############# Objective ##############
@objective(model, Min,
    # Fairness: players who have played more relative to sign-ups cost more to select
    sum(measure[i] * x[i, j] for i = 1:n, j = 1:m)

    # Deficit penalty: heavily penalise falling short of the target squad size
    + w_deficit * sum(d[j] for j in 1:m)

    # Priority reward: incentivise picking priority players who signed up
    + R * sum(A[i, j] * y[i, j] for i in priorSpillere, j = 1:m)

    # Formation coverage reward: one reward unit for each position slot that is filled
    + w_position * sum(pos_covered[j, p] for j in 1:m, p in positions)

    # Extra winger bonus: pos_covered[j,"WIN"] only fires when both wing slots are
    # filled (formation_min=2), so this extra term rewards that outcome more heavily.
    + w_winger * sum(pos_covered[j, "WIN"] for j in 1:m)
)

############# Constraints ##############

# Can only select players who signed up for that match
@constraint(model, [i=1:n, j=1:m], x[i, j] <= A[i, j])

# Exactly antalUdtagede players per match; deficit absorbs any shortfall in sign-ups
@constraint(model, [j=1:m], sum(A[i, j] * x[i, j] for i = 1:n) + d[j] == antalUdtagede)

# Hard cap: never exceed the maximum allowed squad size
@constraint(model, [j=1:m], sum(x[i, j] for i = 1:n) <= maxSpillere)

# Priority linkage: y[i,j] can only be 1 when player i is actually selected
@constraint(model, [i=1:n, j=1:m], y[i, j] <= x[i, j])

# y[i,j] forced to 0 for non-priority players
for i in setdiff(1:n, priorSpillere), j in 1:m
    fix(y[i, j], 0; force=true)
end

# Formation coverage: pos_covered[j,p] = 1 only when at least formation_min[p]
# selected players list position p as preferred.
# For WIN this means at least 2 wingers must be selected before the flag fires.
@constraint(model, [j=1:m, p=positions],
    formation_min[p] * pos_covered[j, p] <=
        sum(x[i, j] for i in 1:n if p in preferredPos[i])
)

######### Solve & Report ##############
optimize!(model)

println("\n========== BocaSchedule Optimization Results ==========")
println("Solver:    HiGHS")
println("Status:    ", termination_status(model))
println("Solve time: $(round(solve_time(model), digits=3))s")

if termination_status(model) == MOI.OPTIMAL
    println("Objective: ", round(objective_value(model), digits=4))

    for j in 1:m
        println("\n─── Match $j ───────────────────────────────────")
        deficit = Int(round(value(d[j])))
        deficit > 0 && println("⚠  Missing $deficit player(s)")

        selected = [i for i in 1:n if value(x[i, j]) > 0.9]
        println("Selected ($(length(selected)) players):")
        for i in selected
            prio  = (i in priorSpillere && value(y[i, j]) > 0.9) ? " [PRIORITY]" : ""
            prefs = join(preferredPos[i], "/")
            println("  Player $i  ($prefs)$prio")
        end

        println("Formation:")
        for p in positions
            covered = value(pos_covered[j, p]) > 0.9
            req     = formation_min[p]
            filled  = sum(value(x[i, j]) for i in 1:n if p in preferredPos[i])
            status  = covered ? "✓" : "✗"
            println("  $status  $p  (need $req, have $(Int(round(filled))))")
        end
    end
else
    println("No optimal solution found: $(termination_status(model))")
end
