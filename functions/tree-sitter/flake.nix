{
  description = "tree-sitter";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.05";
    flake-utils.url = "github:numtide/flake-utils";

    devshell = {
      url = "github:numtide/devshell";
      inputs.nixpkgs.follows = "nixpkgs";
    };

  };

  outputs = { self, nixpkgs, flake-utils, ...}@inputs:
    flake-utils.lib.eachDefaultSystem
      (system:
        let
          overlays = [
            inputs.devshell.overlays.default
          ];
          pkgs = import nixpkgs {
            inherit overlays system;
          };

        in rec {
          packages = rec {
            # darwin versus linux
            dylibExt = if nixpkgs.lib.hasInfix "darwin" system then "dylib" else "so";  

            lib = pkgs.stdenv.mkDerivation {
              name = "lib";
              src = ./.;
              installPhase = ''
                mkdir -p $out/lib;
                cp ${pkgs.tree-sitter}/lib/libtree-sitter.${dylibExt} $out/lib/;
                cp ${pkgs.tree-sitter-grammars.tree-sitter-markdown}/parser $out/lib/libtree-sitter-markdown.${dylibExt};
                cp ${pkgs.tree-sitter-grammars.tree-sitter-python}/parser $out/lib/libtree-sitter-python.${dylibExt};
              '';
            };

            # derive the parser
            parser = pkgs.stdenv.mkDerivation {
              name = "parser";
              src = ./.;
              nativeBuildInputs = [
                pkgs.gcc
                pkgs.findutils
                pkgs.patchelf
              ];
              buildPhase = ''
                ${pkgs.gcc}/bin/gcc -o parser \
                  main.c \
                  -I${pkgs.tree-sitter}/include \
                  ${pkgs.tree-sitter-grammars.tree-sitter-markdown}/parser \
                  ${pkgs.tree-sitter-grammars.tree-sitter-python}/parser \
                  ${pkgs.tree-sitter}/lib/libtree-sitter.${dylibExt}
              '';

              installPhase = ''
                mkdir -p $out/bin;
                cp parser $out/bin/parser;
              '';

              fixupPhase = ''
                find $out -type f -exec patchelf --shrink-rpath '{}' \; -exec strip '{}' \; 2>/dev/null
              '';
            };

            goBinary = pkgs.buildGoModule {
              pname = "tree-sitter-query";
              version = "0.1.0";
              src = ./.; # Assuming your Go code is in the same directory as the flake.nix

              buildInputs = [pkgs.tree-sitter];

              CGO_ENABLED = "1";

              CGO_CFLAGS = "-I${pkgs.tree-sitter}/include";
              
              # If you have vendored dependencies, use this:
              # vendorSha256 = null;
              
              # If you're not using vendored dependencies, compute the hash of your go.mod and go.sum
              # You can get this hash by first setting it to lib.fakeSha256,
              # then running the build and replacing it with the correct hash
              vendorHash = "sha256-ZAlkGegeFLqvHlGD1oA08NS216r6WsWFkajzxI+jLX4=";
              
              # Specify the package to build if it's not in the root of your project
              subPackages = [ "cmd/ts" ];
            };

            # the script must have gh in the PATH
            default = pkgs.writeShellScriptBin "entrypoint" ''
              export PATH=${pkgs.lib.makeBinPath [goBinary]}
              ts "$@"
            '';

          };

          devShells.default = pkgs.devshell.mkShell {
            name = "java-tree-sitter-shell";
            packages = [
              pkgs.tree-sitter
              pkgs.gcc
              (pkgs.clojure.override { jdk = pkgs.openjdk22; })
              pkgs.go # Added Golang
            ];
            commands = [
            ];
          };
        }
      );
}
