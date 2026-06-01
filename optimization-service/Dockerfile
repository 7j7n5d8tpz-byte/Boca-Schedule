FROM julia:1.10-bookworm

WORKDIR /app

COPY Project.toml ./
COPY server.jl ./

# Pre-resolve and precompile into the depot at build time.
# At runtime the compiled cache is stored in a Fly volume at /julia_depot
# so subsequent restarts load in ~30s instead of ~5min.
RUN julia --project=. -e "using Pkg; Pkg.instantiate(); Pkg.precompile()"

ENV JULIA_PORT=3002
ENV JULIA_DEPOT_PATH=/julia_depot:/root/.julia:/usr/local/julia/local/share/julia:/usr/local/julia/share/julia
EXPOSE 3002

CMD ["julia", "--project=.", "server.jl"]
