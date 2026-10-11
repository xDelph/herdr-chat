"""Render the four agreed mobile wireframes as deterministic SVG files.

All names, messages, and statuses below are illustrative fixtures, not live data.
The UI elements follow docs/RELEASE_BACKLOG.md; no terminal or inferred metadata.
"""

from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).parent
W, H = 390, 844
BG, SURFACE, RAISED = "#0b1016", "#131b24", "#1d2935"
LINE, TEXT, MUTED = "#2a3948", "#f4f7fa", "#a9b9c8"
ACCENT, WARM, GREEN = "#8bd8e3", "#efbe80", "#8fd4ab"


def rect(x, y, w, h, fill, r=0, stroke=None):
    edge = f' stroke="{stroke}" stroke-width="1"' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{edge}/>'


def txt(x, y, value, size=14, color=TEXT, weight=400, anchor="start"):
    return (f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" '
            f'font-weight="{weight}" text-anchor="{anchor}" '
            f'font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif">'
            f'{escape(value)}</text>')


def rule(y, x=22, w=346):
    return rect(x, y, w, 1, LINE)


def path(d, color=ACCENT, width=2):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>'


def header(title, subtitle=None, back=False, action=None):
    s = rect(0, 0, W, H, BG)
    s += txt(22, 34, "9:41", 15, TEXT, 650)
    s += txt(353, 34, "●●●", 12, TEXT, 600, "end")
    if back:
        s += txt(22, 84, "<", 23, ACCENT, 500)
        s += txt(51, 84, title, 25, TEXT, 700)
    else:
        s += txt(22, 89, title, 30, TEXT, 720)
    if subtitle:
        s += txt(22 if not back else 51, 111, subtitle, 12, MUTED)
    if action:
        if action == "+":
            s += txt(360, 85, "+", 27, ACCENT, 400, "middle")
        elif action == "menu":
            for x in (343, 354, 365):
                s += f'<circle cx="{x}" cy="78" r="2.2" fill="{ACCENT}"/>'
    return s


def nav(active):
    s = rect(0, 767, 390, 77, SURFACE) + rule(767, 0, 390)
    for x, label in [(70, "Conversations"), (195, "Projets"), (322, "Réglages")]:
        color = ACCENT if label == active else MUTED
        s += txt(x, 807, label, 12, color, 650 if label == active else 400, "middle")
    s += rect(138, 836, 114, 4, "#67737e", 2)
    return s


def card(y, title, meta, excerpt, badge=None, accent=ACCENT, h=106):
    s = rect(16, y, 358, h, SURFACE, 16, LINE)
    s += rect(30, y + 19, 4, 25, accent, 2)
    s += txt(46, y + 31, title, 17, TEXT, 650)
    s += txt(46, y + 54, meta, 12, MUTED)
    if badge:
        bw = 91 if len(badge) > 9 else 73
        s += rect(360 - bw, y + 17, bw, 24, RAISED, 12)
        s += txt(360 - bw / 2, y + 33, badge, 11, accent, 650, "middle")
    if excerpt:
        s += txt(30, y + 84, excerpt, 13, MUTED)
    return s


def save(name, content):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'viewBox="0 0 {W} {H}" role="img" aria-label="Maquette {name}">'
           f'<title>Maquette {name}</title>{content}</svg>')
    (OUT / f"{name}.svg").write_text(svg, encoding="utf-8")


# 1. Inbox: one pane once, ordered by verified status. All example data is fictional.
s = header("Conversations", "Retrouver et reprendre vos agents")
s += txt(22, 150, "À TRAITER", 12, WARM, 750)
s += txt(368, 150, "1", 12, WARM, 650, "end")
s += card(164, "Revue du projet", "Projet Atlas · Pi", "Peux-tu préciser le comportement attendu ?", "Bloqué", WARM)
s += txt(22, 302, "EN COURS", 12, ACCENT, 750)
s += card(317, "Mise à jour du site", "Site vitrine · Pi", None, "Actif", ACCENT, 84)
s += txt(22, 435, "RÉCENTS", 12, MUTED, 750)
s += card(451, "Correction mobile", "Projet Atlas · Pi", "J’ai terminé la vérification.", "Terminé", GREEN)
s += txt(22, 593, "Chaque agent apparaît dans une seule section.", 12, MUTED)
s += nav("Conversations")
save("01-conversations", s)

# 2. Project detail: existing sessions and one explicit new-agent action.
s = header("Projet Atlas", "Conversations de ce projet", back=True)
s += rect(16, 139, 358, 81, SURFACE, 16, LINE)
s += txt(32, 173, "Projet Atlas", 19, TEXT, 650)
s += txt(32, 198, "2 agents dans ce projet", 13, MUTED)
s += txt(22, 259, "CONVERSATIONS", 12, MUTED, 750)
s += card(274, "Revue du projet", "Pi · agent existant", "Peux-tu préciser le comportement attendu ?", "Bloqué", WARM)
s += card(393, "Correction mobile", "Pi · agent existant", "J’ai terminé la vérification.", "Terminé", GREEN)
s += rect(16, 665, 358, 52, ACCENT, 14)
s += txt(195, 698, "Nouvel agent", 16, BG, 700, "middle")
s += nav("Projets")
save("02-projet", s)

# 3. Chat: plain messages; no terminal and no unverified delivery success.
s = header("Revue du projet", "Projet Atlas · Pi · Bloqué", back=True, action="menu")
s += rule(129, 0, 390)
s += rect(20, 151, 296, 50, RAISED, 15)
s += txt(35, 173, "Tu peux vérifier la navigation", 14, TEXT)
s += txt(35, 191, "sur mobile ?", 14, TEXT)
s += rect(44, 224, 326, 109, SURFACE, 15, LINE)
s += txt(60, 248, "J’ai parcouru les écrans.", 14, TEXT)
s += txt(60, 272, "Peux-tu préciser le comportement", 14, TEXT)
s += txt(60, 294, "attendu du bouton de lancement ?", 14, TEXT)
s += rect(44, 350, 326, 48, "#342c24", 12)
s += txt(60, 380, "●  Agent bloqué", 13, WARM, 650)
s += rect(0, 712, 390, 132, SURFACE)
s += rule(712, 0, 390)
s += rect(16, 728, 309, 52, RAISED, 16)
s += txt(32, 760, "Écrire un message…", 14, MUTED)
s += rect(336, 728, 38, 52, ACCENT, 14)
s += txt(355, 763, "^", 24, BG, 700, "middle")
s += rect(138, 836, 114, 4, "#67737e", 2)
save("03-chat", s)

# 4. Launch sheet: options are conditional on actual installed kinds/catalogues.
s = header("Projet Atlas", "Conversations de ce projet", back=True)
s += rect(0, 119, 390, 725, "#06090dbb")
s += rect(0, 210, 390, 634, SURFACE, 24)
s += rect(165, 222, 60, 5, LINE, 3)
s += txt(22, 266, "Nouvel agent", 24, TEXT, 700)
s += txt(22, 291, "Projet Atlas", 13, MUTED)
s += txt(22, 334, "TYPE INSTALLÉ", 11, MUTED, 700)
s += rect(16, 347, 358, 56, RAISED, 12)
s += txt(32, 381, "Pi", 16, TEXT, 600)
s += txt(353, 381, "v", 17, MUTED, 500, "end")
s += txt(22, 440, "MODÈLE", 11, MUTED, 700)
s += rect(16, 453, 358, 56, RAISED, 12)
s += txt(32, 487, "Laisser le choix à Pi", 15, TEXT)
s += txt(353, 487, "v", 17, MUTED, 500, "end")
s += txt(22, 548, "RAISONNEMENT", 11, MUTED, 700)
s += rect(16, 561, 358, 56, RAISED, 12)
s += txt(32, 595, "Laisser le choix à Pi", 15, TEXT)
s += txt(353, 595, "v", 17, MUTED, 500, "end")
s += txt(22, 646, "Options proposées selon le catalogue disponible.", 12, MUTED)
s += rect(16, 734, 358, 54, ACCENT, 14)
s += txt(195, 768, "Lancer l’agent", 16, BG, 700, "middle")
s += rect(138, 836, 114, 4, "#67737e", 2)
save("04-lancement", s)
