# syntax = docker/dockerfile:1.4
FROM nixos/nix:2.21.1@sha256:3f6c77ee4d2c82e472e64e6cd7087241dc391421a0b42c22e6849c586d5398d9 AS builder

WORKDIR /tmp/build
RUN mkdir /tmp/nix-store-closure

# ignore SC2046 because the output of nix-store -qR will never have spaces - this is safe here
# hadolint ignore=SC2046
RUN --mount=type=cache,target=/nix,from=nixos/nix:2.21.1,source=/nix \
    --mount=type=cache,target=/root/.cache \
    --mount=type=bind,target=/tmp/build \
    <<EOF
  nix \
    --extra-experimental-features "nix-command flakes" \
    --option filter-syscalls false \
    --extra-trusted-substituters "https://cache.iog.io" \
    --extra-trusted-public-keys "hydra.iohk.io:f/Ea+s+dFdN+3Y/G+FDgSq+a5NEWhJGzdjvKNGv0/EQ=" \
    --show-trace \
    --log-format bar-with-logs \
    build . --out-link /tmp/output/result
  cp -R $(nix-store -qR /tmp/output/result) /tmp/nix-store-closure
EOF

FROM scratch

# my convention is that images have only two top-level folders
# /nix/store has all of the software
# /app/result has symbolic links for any entrypoints needed
WORKDIR /app
COPY --from=builder /tmp/nix-store-closure /nix/store
COPY --from=builder /tmp/output/ /app/

# programs like curl needs the /tmp directory to already exist
# what is the right way to manage things like this?
COPY <<EOF /tmp/.blank
empty
EOF

ENTRYPOINT ["/app/result/bin/entrypoint"]
