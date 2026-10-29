# Formule Homebrew (T066) — préparée, non publiée.
#
# ⚠️ Rien n'est publié ici : la formule est un GABARIT de ce que `brew install`
# devra faire, et « elle existe » ne veut pas dire « elle a été testée sur une
# installation réelle ». Les empreintes seront remplies par l'assemblage
# (`xtask release`), jamais recopiées à la main d'un run à l'autre.
class HerdrChat < Formula
  desc "PWA distante pour Herdr (serveur Rust, binaire unique)"
  homepage "https://github.com/herdr/remote"
  version "0.2.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://example.invalid/herdr-chat-macos-arm64.tar.gz"
      sha256 "A_REMPLACER_PAR_XTASK_RELEASE"
    end
    on_intel do
      url "https://example.invalid/herdr-chat-macos-x86_64.tar.gz"
      sha256 "A_REMPLACER_PAR_XTASK_RELEASE"
    end
  end

  on_linux do
    on_arm do
      url "https://example.invalid/herdr-chat-linux-aarch64.tar.gz"
      sha256 "A_REMPLACER_PAR_XTASK_RELEASE"
    end
    on_intel do
      url "https://example.invalid/herdr-chat-linux-x86_64.tar.gz"
      sha256 "A_REMPLACER_PAR_XTASK_RELEASE"
    end
  end

  def install
    bin.install "herdrchat"
    # Le service est un fichier fourni, pas un lancement implicite.
    (share/"herdr-chat").install "herdr-chat.service" if OS.linux?
  end

  test do
    # Un binaire qui répond à `--version` sans Bun, sans Node, sans base
    # système : c'est la propriété que l'archive doit garantir.
    assert_match "herdrchat", shell_output("#{bin}/herdrchat --version")
  end

  service do
    run [opt_bin/"herdrchat"]
    keep_alive true
    environment_variables HERDR_REMOTE_BIND: "127.0.0.1", HERDR_REMOTE_PORT: "8791"
  end
end
