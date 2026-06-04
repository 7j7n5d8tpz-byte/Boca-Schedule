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
# cpu_target must be a portable multi-target string (same as Julia's official
# x86_64 binaries), NOT the default `native`. Fly doesn't pin machines to a CPU
# model, so a native sysimage built on e.g. a znver3 runner is rejected at load
# ("Unable to find compatible target in cached code image") when the machine is
# rescheduled onto a different host CPU, crash-looping until max restarts.
RUN julia --project=. -e " \
  import Pkg; \
  Pkg.instantiate(); \
  Pkg.add(\"PackageCompiler\"); \
  using PackageCompiler; \
  create_sysimage( \
    [:HTTP, :JSON3, :JuMP, :HiGHS, :MathOptInterface], \
    sysimage_path=\"/app/boca.so\", \
    project=\".\", \
    cpu_target=\"generic;sandybridge,-xsaveopt,clone_all;haswell,-rdrnd,base(1)\", \
  )"

ENV JULIA_PORT=3002
EXPOSE 3002

CMD ["julia", "--project=.", "--sysimage=/app/boca.so", "server.jl"]
