"""Valida a estrutura base do projeto e as regras do .gitignore.

Executar na raiz do repositório:  python3 -m unittest discover -s tests -v
"""

import subprocess
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

PASTAS = [
    "Videos Brutos",
    "Referências",
    "Exportações",
    "IA/Memoria",
    "IA/Aprendizado",
    "IA/Perfis",
    "IA/Feedback",
    "IA/Analises",
    "IA/Conhecimento",
    "Pipeline/ingestion",
    "Pipeline/analysis",
    "Pipeline/transcription",
    "Pipeline/editing",
    "Pipeline/rendering",
    "Pipeline/quality-control",
    "src",
    "scripts",
    "config",
    "tests",
    "docs",
    ".claude",
]

DEVEM_SER_IGNORADOS = [
    "Videos Brutos/gravacao.mp4",
    "Videos Brutos/projeto/notas.txt",
    "Referências/exemplo.mov",
    "Exportações/final.mkv",
    "src/amostra.mp4",
    "renders/corte.png",
    ".cache/x",
    "src/__pycache__/m.pyc",
    "tmp/a.txt",
    "execucao.log",
    ".env",
    ".env.local",
    "config/credentials.json",
    "config/chave.pem",
    "node_modules/pkg/index.js",
    ".venv/bin/python",
    "models/whisper.pt",
]

NAO_DEVEM_SER_IGNORADOS = [
    "README.md",
    "docs/ARQUITETURA.md",
    "src/main.py",
    "config/padrao.yaml",
    ".env.example",
    "Videos Brutos/.gitkeep",
    "Referências/.gitkeep",
    "Exportações/.gitkeep",
    "IA/Perfis/perfil.json",
]


def ignorado(caminho: str) -> bool:
    resultado = subprocess.run(
        ["git", "check-ignore", "-q", "--no-index", caminho],
        cwd=RAIZ,
        check=False,
    )
    return resultado.returncode == 0


class TestEstrutura(unittest.TestCase):
    def test_pastas_existem(self):
        for pasta in PASTAS:
            with self.subTest(pasta=pasta):
                self.assertTrue((RAIZ / pasta).is_dir())

    def test_arquivos_base_existem(self):
        for arquivo in ["README.md", ".gitignore", "docs/ARQUITETURA.md"]:
            with self.subTest(arquivo=arquivo):
                self.assertTrue((RAIZ / arquivo).is_file())


class TestGitignore(unittest.TestCase):
    def test_ignora_midia_caches_temporarios_e_credenciais(self):
        for caminho in DEVEM_SER_IGNORADOS:
            with self.subTest(caminho=caminho):
                self.assertTrue(ignorado(caminho))

    def test_preserva_codigo_docs_e_marcadores(self):
        for caminho in NAO_DEVEM_SER_IGNORADOS:
            with self.subTest(caminho=caminho):
                self.assertFalse(ignorado(caminho))


if __name__ == "__main__":
    unittest.main()
