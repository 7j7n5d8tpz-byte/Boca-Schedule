using DataFrames, Random, Gurobi, JuMP

############# Data #################

n = 20 #Antal medlemmer
m = 4 #Antal kampe 
p = 3 #Antal prioritets spillere

R = -1
w = 0.9

totalKampe = 15
spilledeK = rand(1:9, n)
tilmeldteK = zeros(Int, n)
for i in 1:n
    tilmeldteK[i] = rand(spilledeK[i]:totalKampe)
end

measure = (w .* spilledeK - (1 - w) .* tilmeldteK) ./ totalKampe


A = rand(0:1, (n, m))
priorSpillere = randperm(n)[1:3] #Prioritetsspillere
antalUdtagede = 10

######### Model ##############
model = Model(Gurobi.Optimizer)

@variable(model, x[i=1:n, j=1:m], Bin)
@variable(model, y[k=1:n, j=1:m], Bin)
@variable(model, d[j=1:m] >= 0, Int)

@objective(model, Min, sum(measure[i] * x[i, j] for i = 1:n, j = 1:m) + totalKampe * sum(d[j] for j in 1:m) + R * sum(A[i, j] * y[i, j] for i ∈ priorSpillere, j = 1:m))

@constraint(model, [j = 1:m], sum(A[i, j] * x[i, j] for i = 1:n) + d[j] == 10)
@constraint(model, [i = 1:n, j = 1:m], y[i, j] <= x[i, j])

optimize!(model)

println("This is the solution: ")


let
    if termination_status(model) == MOI.OPTIMAL
        println("RESULTS:")
        println("This is the objective:", objective_value(model))
        for j in 1:m
            println("\n############### Kamp nr $j ################")
            println("Kamp $j mangler $(Int(value.(d)[j])) spiller(e)\n")
            for i in 1:n
                if value.(x)[i, j] > 0.9
                    println("Spiller $i skal spille her!")
                end
                if value.(y)[i, j] > 0.9
                    println("(Spiller $i er en prioritetsspiller)")
                end
            end
            println("\n###########################################")
        end

    else
        println("  Non-optimal solution: $(objective_value(model))")
    end
end