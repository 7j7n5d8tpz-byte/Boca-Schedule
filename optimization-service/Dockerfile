FROM julia:1.10-bookworm

WORKDIR /app

# Copy project files
COPY Project.toml ./
COPY server.jl ./

# Instantiate resolves and pins dependencies at build time (writes Manifest.toml)
RUN julia --project=. -e "using Pkg; Pkg.instantiate(); Pkg.precompile()"

# Bind on all interfaces; port configurable via JULIA_PORT env var
ENV JULIA_PORT=3002
EXPOSE 3002

CMD ["julia", "--project=.", "server.jl"]
