FROM julia:1.10-bookworm

WORKDIR /app

# PackageCompiler requires gcc to link the sysimage shared library
RUN apt-get update && apt-get install -y gcc && rm -rf /var/lib/apt/lists/*

COPY Project.toml ./
COPY server.jl ./

# Build a sysimage with all packages baked in.
# Reduces cold-start from ~5 min to ~5 sec.
# Must be built on native x86_64 (GitHub Actions) — QEMU on Apple Silicon
# causes a segfault during HTTP.jl precompilation.
RUN julia --project=. -e " \
  import Pkg; \
  Pkg.instantiate(); \
  Pkg.add(\"PackageCompiler\"); \
  using PackageCompiler; \
  create_sysimage( \
    [:HTTP, :JSON3, :JuMP, :HiGHS, :MathOptInterface], \
    sysimage_path=\"/app/boca.so\", \
    project=\".\", \
  )"

ENV JULIA_PORT=3002
EXPOSE 3002

CMD ["julia", "--project=.", "--sysimage=/app/boca.so", "server.jl"]
