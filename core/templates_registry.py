"""
Creative visual template registry for Knock-Knock.

Drop this file into: core/templates_registry.py

The live presenter page already reads `template.bg_css` for the full stage
background and `template.overlay` for an optional overlay layer. The template
picker also uses the same values for the preview tiles.

No database migration is needed because questionnaires/quizzes store only the
selected `template_id` string.
"""
from urllib.parse import quote


def _svg_url(svg: str) -> str:
    """Return a CSS url(data:image/svg+xml,...) value that is safe inside inline CSS."""
    return 'url("data:image/svg+xml,' + quote(svg, safe="/:;,%#@&=+$()[]!'*?") + '")'


def _dots(color: str = "#ffffff", opacity: float = 0.12, size: int = 48) -> str:
    return _svg_url(
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{size}' height='{size}' viewBox='0 0 {size} {size}'>"
        f"<circle cx='4' cy='4' r='1.6' fill='{color}' fill-opacity='{opacity}'/>"
        f"<circle cx='{size-10}' cy='{size//2}' r='1.1' fill='{color}' fill-opacity='{opacity * .8}'/>"
        f"</svg>"
    )


def _grid(color: str = "#ffffff", opacity: float = 0.08, size: int = 56) -> str:
    return _svg_url(
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{size}' height='{size}' viewBox='0 0 {size} {size}'>"
        f"<path d='M0 .5H{size}M.5 0V{size}' stroke='{color}' stroke-opacity='{opacity}' stroke-width='1'/>"
        f"</svg>"
    )


def _diagonal(color: str = "#ffffff", opacity: float = 0.10) -> str:
    return _svg_url(
        f"<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>"
        f"<path d='M-4 28L28-4' stroke='{color}' stroke-opacity='{opacity}' stroke-width='3'/>"
        f"</svg>"
    )


def _neon_geometry() -> str:
    return _svg_url("""
    <svg xmlns='http://www.w3.org/2000/svg' width='900' height='520' viewBox='0 0 900 520'>
      <g fill='none' stroke-linecap='round' stroke-linejoin='round'>
        <path d='M115 75 205 225 25 225Z' stroke='%23c026ff' stroke-width='4' opacity='.75'/>
        <path d='M145 115 185 190 85 190Z' stroke='%2322d3ee' stroke-width='2' opacity='.65'/>
        <path d='M520 85 690 410 320 410Z' stroke='%23d946ef' stroke-width='5' opacity='.85'/>
        <path d='M520 190 600 335 435 335Z' fill='%23d000ff' opacity='.72'/>
        <path d='M795 25 880 175 705 175Z' stroke='%2322d3ee' stroke-width='4' opacity='.75'/>
        <path d='M145 370 210 475 80 475Z' stroke='%23d946ef' stroke-width='3' opacity='.70'/>
        <path d='M360 35 385 70 335 70Z' fill='%23d946ef' opacity='.80'/>
        <path d='M705 265 725 300 685 300Z' fill='%2322d3ee' opacity='.75'/>
        <path d='M285 325 310 365 255 365Z' fill='%23e879f9' opacity='.60'/>
        <circle cx='70' cy='85' r='24' fill='%2322d3ee' opacity='.65'/>
        <circle cx='760' cy='365' r='47' fill='%23d946ef' opacity='.72'/>
        <circle cx='770' cy='365' r='35' fill='none' stroke='%230b1020' stroke-width='11' stroke-dasharray='26 16' opacity='.75'/>
        <circle cx='650' cy='160' r='22' fill='%2322d3ee' opacity='.70'/>
        <circle cx='180' cy='310' r='9' fill='%23d946ef' opacity='.80'/>
        <circle cx='610' cy='70' r='6' stroke='%2322d3ee' stroke-width='2' opacity='.65'/>
        <circle cx='835' cy='250' r='12' stroke='%2322d3ee' stroke-width='2' opacity='.45'/>
        <path d='M55 310l55-70M820 440l45-95M280 45l-40 75M690 55l42 58M745 95l-22 52' stroke='%23c026ff' stroke-width='2' opacity='.55'/>
      </g>
    </svg>
    """)


def _purple_motion() -> str:
    return _svg_url("""
    <svg xmlns='http://www.w3.org/2000/svg' width='900' height='520' viewBox='0 0 900 520'>
      <defs>
        <linearGradient id='g1' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0' stop-color='%23f0abfc'/><stop offset='.45' stop-color='%2322d3ee'/><stop offset='1' stop-color='%23facc15'/>
        </linearGradient>
        <linearGradient id='g2' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0' stop-color='%23f0abfc'/><stop offset='1' stop-color='%237c3aed'/>
        </linearGradient>
      </defs>
      <g opacity='.75'>
        <rect x='-70' y='45' width='340' height='34' rx='17' fill='url(%23g1)' transform='rotate(-42 100 60)'/>
        <rect x='180' y='110' width='390' height='44' rx='22' fill='url(%23g1)' transform='rotate(-48 370 130)'/>
        <rect x='620' y='35' width='360' height='32' rx='16' fill='%23facc15' transform='rotate(-42 790 50)'/>
        <rect x='565' y='175' width='430' height='31' rx='16' fill='url(%23g2)' transform='rotate(-43 760 190)'/>
        <rect x='-80' y='365' width='420' height='38' rx='20' fill='%23d946ef' transform='rotate(-42 90 380)'/>
        <circle cx='95' cy='105' r='31' fill='%23f0abfc'/>
        <circle cx='665' cy='118' r='14' fill='%2322d3ee'/>
        <circle cx='735' cy='310' r='34' fill='url(%23g1)'/>
        <circle cx='370' cy='260' r='10' fill='%23f0abfc'/>
        <circle cx='535' cy='350' r='12' fill='%23f0abfc'/>
      </g>
      <g stroke='%23ffffff' stroke-opacity='.16' stroke-width='2'>
        <path d='M140 70h190M90 225h280M520 60h180M455 430h250' stroke-dasharray='5 12'/>
        <circle cx='210' cy='250' r='82' fill='none'/>
        <circle cx='780' cy='95' r='50' fill='none'/>
      </g>
    </svg>
    """)


def _blue_crystals() -> str:
    return _svg_url("""
    <svg xmlns='http://www.w3.org/2000/svg' width='900' height='520' viewBox='0 0 900 520'>
      <g opacity='.45'>
        <polygon points='535,0 900,0 900,520 680,520 565,320 705,205' fill='%230ea5e9'/>
        <polygon points='650,40 865,155 770,330 555,220' fill='%231d4ed8' opacity='.70'/>
        <polygon points='370,0 610,85 505,285 280,185' fill='%2338bdf8' opacity='.35'/>
        <polygon points='625,280 835,390 720,520 510,405' fill='%230ea5e9' opacity='.65'/>
        <polygon points='80,0 350,0 460,125 225,230 0,120' fill='%23e0f2fe' opacity='.38'/>
      </g>
      <g stroke='%23ffffff' stroke-opacity='.12' stroke-width='2'>
        <path d='M420 0 725 520M285 0 635 520M790 0 505 520M0 120 900 340M0 285 900 80'/>
      </g>
    </svg>
    """)


def _mint_leaves() -> str:
    return _svg_url("""
    <svg xmlns='http://www.w3.org/2000/svg' width='900' height='520' viewBox='0 0 900 520'>
      <g fill='none' stroke='%230f766e' stroke-width='2.5' stroke-linecap='round' opacity='.28'>
        <path d='M45 40C120 85 135 165 85 230'/>
        <path d='M78 66c-18 18-25 36-21 58M112 91c-25 15-39 37-43 68M130 133c-23 7-42 23-58 48'/>
        <path d='M835 30C760 95 740 170 785 248'/>
        <path d='M805 70c26 4 44 15 56 34M775 112c33-2 58 7 76 28M765 160c30-4 55 0 77 13'/>
        <path d='M120 470C210 420 300 430 380 500'/>
        <path d='M155 455c14 27 36 43 66 48M210 438c12 31 35 51 70 58M275 448c12 25 32 40 61 45'/>
      </g>
      <g fill='%23ffffff' opacity='.18'>
        <circle cx='118' cy='118' r='15'/><circle cx='740' cy='100' r='10'/><circle cx='675' cy='395' r='18'/><circle cx='270' cy='245' r='11'/>
      </g>
      <g fill='%230f766e' opacity='.08'>
        <path d='M0 120C70 45 150 45 220 110C140 120 90 160 55 230C35 190 15 160 0 120Z'/>
        <path d='M900 410C820 490 720 490 660 420C740 410 795 370 835 300C860 340 880 375 900 410Z'/>
      </g>
    </svg>
    """)


def _forest_cabin() -> str:
    return _svg_url("""
    <svg xmlns='http://www.w3.org/2000/svg' width='1200' height='680' viewBox='0 0 1200 680'>
      <defs>
        <linearGradient id='sun' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stop-color='%23fff7c2'/><stop offset='1' stop-color='%23f59e0b'/>
        </linearGradient>
      </defs>
      <rect width='1200' height='680' fill='none'/>
      <circle cx='620' cy='190' r='135' fill='url(%23sun)' opacity='.55'/>
      <path d='M0 505C190 390 390 410 585 500C780 590 980 455 1200 520V680H0Z' fill='%234a6f38' opacity='.95'/>
      <path d='M0 570C240 470 430 535 650 595C840 645 990 570 1200 600V680H0Z' fill='%232f4f2c'/>
      <g fill='%23182716'>
        <path d='M50 0h80l-25 680H15Z'/><path d='M100 0h55L190 680H88Z'/>
        <path d='M1060 0h80l-65 680h-90Z'/><path d='M1160 0h45v680h-92Z'/>
      </g>
      <g fill='%232d4b2a'>
        <path d='M300 445l70-190 70 190Z'/><path d='M380 455l65-220 80 220Z'/><path d='M880 455l60-200 85 200Z'/><path d='M780 468l52-165 65 165Z'/>
      </g>
      <g transform='translate(835 390)'>
        <rect x='15' y='85' width='185' height='110' fill='%23451a12'/>
        <polygon points='0,90 105,0 220,90' fill='%237c2d12'/>
        <polygon points='44,78 105,27 169,78' fill='%23f7e7c0' opacity='.85'/>
        <rect x='75' y='118' width='50' height='77' fill='%2326130c'/>
        <rect x='142' y='112' width='34' height='32' fill='%23fde68a' opacity='.8'/>
        <rect x='-8' y='190' width='230' height='20' fill='%23f8ecd8'/>
        <rect x='-5' y='170' width='12' height='38' fill='%23f8ecd8'/><rect x='38' y='170' width='12' height='38' fill='%23f8ecd8'/><rect x='205' y='170' width='12' height='38' fill='%23f8ecd8'/>
      </g>
      <g stroke='%23f8ecd8' stroke-width='8' opacity='.16'>
        <path d='M0 120 330 0M75 210 420 0M1030 0 1200 160'/>
      </g>
      <g fill='%23924516' opacity='.9'>
        <rect x='55' y='555' width='320' height='22' rx='8' transform='rotate(-10 55 555)'/>
        <rect x='75' y='505' width='20' height='85'/><rect x='152' y='495' width='20' height='95'/><rect x='235' y='495' width='20' height='95'/><rect x='315' y='505' width='20' height='85'/>
      </g>
    </svg>
    """)


def _afro_sunrise() -> str:
    return _svg_url("""
    <svg xmlns='http://www.w3.org/2000/svg' width='900' height='520' viewBox='0 0 900 520'>
      <circle cx='450' cy='260' r='170' fill='%23fbbf24' opacity='.58'/>
      <circle cx='450' cy='260' r='120' fill='%23fb7185' opacity='.38'/>
      <g fill='none' stroke='%23fff7ed' stroke-width='2' opacity='.22'>
        <circle cx='450' cy='260' r='210'/><circle cx='450' cy='260' r='250'/><circle cx='450' cy='260' r='290'/>
        <path d='M0 260h900M450 0v520M145 55l610 410M755 55 145 465'/>
      </g>
      <g fill='%231a0b2e' opacity='.55'>
        <path d='M0 405C110 350 220 360 330 420C460 490 580 380 710 420C810 450 865 435 900 410V520H0Z'/>
      </g>
    </svg>
    """)


def _circuit_glow() -> str:
    return _svg_url("""
    <svg xmlns='http://www.w3.org/2000/svg' width='900' height='520' viewBox='0 0 900 520'>
      <g fill='none' stroke='%2322d3ee' stroke-width='3' stroke-linecap='round' stroke-linejoin='round' opacity='.45'>
        <path d='M80 80h210v90h150v110h200v150h185'/>
        <path d='M130 390h160v-90h130V190h170V70h180'/>
        <path d='M40 250h165v-85h120M575 310h125v-85h160M380 450V335h95'/>
        <circle cx='290' cy='80' r='12'/><circle cx='440' cy='170' r='12'/><circle cx='640' cy='280' r='12'/><circle cx='825' cy='430' r='12'/><circle cx='130' cy='390' r='12'/><circle cx='770' cy='70' r='12'/>
      </g>
      <g fill='%23a7f3d0' opacity='.18'>
        <circle cx='215' cy='165' r='55'/><circle cx='700' cy='225' r='75'/><circle cx='420' cy='335' r='42'/>
      </g>
    </svg>
    """)


TEMPLATES = [
    {
        "id": "neon_geometry", "name": "Neon Geometry",
        "bg": "#130b35", "fg": "#f8fbff",
        "accent": "#d946ef", "accent2": "#22d3ee", "font": "Clash Display",
        "bg_css": (
            "radial-gradient(900px 600px at 50% 35%, rgba(217,70,239,.32), transparent 58%),"
            "linear-gradient(135deg, #130b35 0%, #23124d 55%, #0f172a 100%)"
        ),
        "overlay": _neon_geometry(),
    },
    {
        "id": "purple_motion", "name": "Purple Motion",
        "bg": "#4c0f7a", "fg": "#fff7ff",
        "accent": "#f0abfc", "accent2": "#22d3ee", "font": "Poppins",
        "bg_css": (
            "radial-gradient(circle at 50% 50%, rgba(236,72,153,.45), transparent 30%),"
            "radial-gradient(circle at 20% 20%, rgba(168,85,247,.42), transparent 42%),"
            "linear-gradient(135deg, #5b21b6 0%, #86198f 52%, #581c87 100%)"
        ),
        "overlay": _purple_motion(),
    },
    {
        "id": "blue_crystal", "name": "Blue Crystal",
        "bg": "#e0f7ff", "fg": "#082f49",
        "accent": "#0284c7", "accent2": "#1d4ed8", "font": "Inter",
        "bg_css": (
            "linear-gradient(90deg, rgba(255,255,255,.98) 0%, rgba(224,242,254,.88) 36%, rgba(14,165,233,.32) 100%),"
            "linear-gradient(135deg, #f8feff 0%, #bae6fd 58%, #1d4ed8 100%)"
        ),
        "overlay": _blue_crystals(),
    },
    {
        "id": "mint_leaves", "name": "Mint Leaves",
        "bg": "#a7f3d0", "fg": "#064e3b",
        "accent": "#0f766e", "accent2": "#f59e0b", "font": "Manrope",
        "bg_css": (
            "radial-gradient(600px 420px at 35% 38%, rgba(255,255,255,.28), transparent 65%),"
            "linear-gradient(135deg, #bbf7d0 0%, #99f6e4 55%, #a7f3d0 100%)"
        ),
        "overlay": _mint_leaves(),
    },
    {
        "id": "forest_cabin", "name": "Forest Cabin",
        "bg": "#f4d48a", "fg": "#fff7ed",
        "accent": "#f59e0b", "accent2": "#86efac", "font": "Lora",
        "bg_css": (
            "linear-gradient(180deg, #f7df9d 0%, #d9b56b 38%, #3f6f3a 100%)"
        ),
        "overlay": _forest_cabin(),
    },
    {
        "id": "afro_sunrise", "name": "Afro Sunrise",
        "bg": "#2a0f3a", "fg": "#fff7ed",
        "accent": "#f59e0b", "accent2": "#fb7185", "font": "Cormorant Garamond",
        "bg_css": (
            "radial-gradient(circle at 50% 50%, rgba(251,191,36,.28), transparent 38%),"
            "linear-gradient(135deg, #1a0b2e 0%, #7c2d12 48%, #be123c 100%)"
        ),
        "overlay": _afro_sunrise(),
    },
    {
        "id": "circuit_glow", "name": "Circuit Glow",
        "bg": "#020617", "fg": "#ecfeff",
        "accent": "#22d3ee", "accent2": "#a3e635", "font": "JetBrains Mono",
        "bg_css": (
            "radial-gradient(700px 500px at 70% 35%, rgba(34,211,238,.22), transparent 60%),"
            "radial-gradient(500px 400px at 15% 80%, rgba(163,230,53,.13), transparent 62%),"
            "linear-gradient(135deg, #020617 0%, #06202e 100%)"
        ),
        "overlay": _circuit_glow(),
    },
    {
        "id": "sunset_bloom", "name": "Sunset Bloom",
        "bg": "#1a0b2e", "fg": "#fff5ec",
        "accent": "#fb7185", "accent2": "#fbbf24", "font": "Poppins",
        "bg_css": (
            "radial-gradient(760px 520px at 18% 18%, rgba(251,191,36,.42), transparent 62%),"
            "radial-gradient(820px 620px at 78% 92%, rgba(251,113,133,.48), transparent 60%),"
            "linear-gradient(135deg, #1a0b2e 0%, #5b1f4f 60%, #7c2d12 100%)"
        ),
        "overlay": _dots("#fff5ec", .07),
    },
    {
        "id": "ocean_depth", "name": "Ocean Depth",
        "bg": "#02132b", "fg": "#e6f1ff",
        "accent": "#38bdf8", "accent2": "#a78bfa", "font": "Manrope",
        "bg_css": (
            "radial-gradient(900px 600px at 50% 0%, rgba(56,189,248,.32), transparent 65%),"
            "radial-gradient(700px 500px at 0% 100%, rgba(167,139,250,.26), transparent 65%),"
            "linear-gradient(180deg, #02132b 0%, #0a2540 100%)"
        ),
        "overlay": _dots("#38bdf8", .12),
    },
    {
        "id": "soft_paper", "name": "Soft Paper",
        "bg": "#fdfaf3", "fg": "#1c1c1c",
        "accent": "#d97706", "accent2": "#0d9488", "font": "Lora",
        "bg_css": (
            "radial-gradient(800px 500px at 100% 0%, rgba(217,119,6,.12), transparent 70%),"
            "linear-gradient(135deg, #fdfaf3 0%, #f5ecd9 100%)"
        ),
        "overlay": _dots("#1c1c1c", .05),
    },
    {
        "id": "minimal_white", "name": "Minimal White",
        "bg": "#ffffff", "fg": "#111111",
        "accent": "#111827", "accent2": "#6b7280", "font": "Inter",
        "bg_css": "linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)",
        "overlay": _grid("#000000", .035),
    },
    {
        "id": "retro_arcade", "name": "Retro Arcade",
        "bg": "#1a0033", "fg": "#fef9ff",
        "accent": "#ff2e88", "accent2": "#00e5ff", "font": "Press Start 2P",
        "bg_css": (
            "radial-gradient(800px 600px at 50% 100%, rgba(255,46,136,.40), transparent 60%),"
            "linear-gradient(180deg, #1a0033 0%, #2d004d 50%, #5b005b 100%)"
        ),
        "overlay": _grid("#facc15", .08),
    },
    {
        "id": "obsidian_gold", "name": "Obsidian Gold",
        "bg": "#18181b", "fg": "#fafaf9",
        "accent": "#eab308", "accent2": "#f97316", "font": "Cormorant Garamond",
        "bg_css": (
            "radial-gradient(700px 500px at 50% 0%, rgba(234,179,8,.18), transparent 65%),"
            "radial-gradient(500px 400px at 50% 100%, rgba(249,115,22,.15), transparent 65%),"
            "linear-gradient(180deg, #18181b 0%, #0a0a0a 100%)"
        ),
        "overlay": _dots("#eab308", .065),
    },
    {
        "id": "blueprint_grid", "name": "Blueprint Grid",
        "bg": "#0c4a6e", "fg": "#e0f2fe",
        "accent": "#fef9c3", "accent2": "#fb7185", "font": "JetBrains Mono",
        "bg_css": (
            "radial-gradient(700px 500px at 50% 0%, rgba(224,242,254,.12), transparent 65%),"
            "linear-gradient(180deg, #0c4a6e 0%, #082f49 100%)"
        ),
        "overlay": _grid("#e0f2fe", .13),
    },
    {
        "id": "sakura_bloom", "name": "Sakura Bloom",
        "bg": "#fff1f3", "fg": "#831843",
        "accent": "#f43f5e", "accent2": "#a3e635", "font": "Lora",
        "bg_css": (
            "radial-gradient(600px 400px at 80% 20%, rgba(244,63,94,.20), transparent 65%),"
            "radial-gradient(500px 400px at 20% 80%, rgba(163,230,53,.16), transparent 65%),"
            "linear-gradient(135deg, #fff1f3 0%, #ffe4e6 100%)"
        ),
        "overlay": _dots("#831843", .06),
    },
    {
        "id": "corporate_blue", "name": "Corporate Blue",
        "bg": "#f1f5f9", "fg": "#0f172a",
        "accent": "#1d4ed8", "accent2": "#0ea5e9", "font": "Inter",
        "bg_css": (
            "radial-gradient(700px 500px at 100% 0%, rgba(29,78,216,.12), transparent 65%),"
            "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)"
        ),
        "overlay": _grid("#0f172a", .045),
    },


    {
        "id": "space_station", "name": "Space Station",
        "bg": "#060b1f", "fg": "#f5f7ff",
        "accent": "#8b5cf6", "accent2": "#38bdf8", "font": "Orbitron",
        "bg_css": (
            "linear-gradient(rgba(6,11,31,.32), rgba(6,11,31,.46)),"
            "url('/static/images/templates/space_station.png') center / cover no-repeat"
        ),
        "overlay": _grid("#8ab4ff", .035),
    },
    {
        "id": "voxel_world", "name": "Voxel World",
        "bg": "#cfeeff", "fg": "#17324d",
        "accent": "#67c23a", "accent2": "#22a6f2", "font": "Poppins",
        "bg_css": (
            "linear-gradient(rgba(255,255,255,.08), rgba(255,255,255,.08)),"
            "url('/static/images/templates/voxel_world.png') center / cover no-repeat"
        ),
        "overlay": _dots("#ffffff", .05),
    },
    {
        "id": "arcade_energy", "name": "Arcade Energy",
        "bg": "#0d0825", "fg": "#f9f2ff",
        "accent": "#ff38d1", "accent2": "#2ecbff", "font": "Orbitron",
        "bg_css": (
            "linear-gradient(rgba(13,8,37,.22), rgba(13,8,37,.38)),"
            "url('/static/images/templates/arcade_energy.png') center / cover no-repeat"
        ),
        "overlay": _grid("#ffffff", .028),
    },
    {
        "id": "fantasy_ruins", "name": "Fantasy Ruins",
        "bg": "#f3e8c7", "fg": "#2f2a1b",
        "accent": "#5eead4", "accent2": "#c084fc", "font": "Lora",
        "bg_css": (
            "linear-gradient(rgba(255,250,235,.14), rgba(255,250,235,.14)),"
            "url('/static/images/templates/fantasy_ruins.png') center / cover no-repeat"
        ),
        "overlay": _dots("#fff7ed", .04),
    },
    {
        "id": "holo_code", "name": "Holo Code",
        "bg": "#030918", "fg": "#e6f2ff",
        "accent": "#00c2ff", "accent2": "#8b5cf6", "font": "JetBrains Mono",
        "bg_css": (
            "linear-gradient(rgba(3,9,24,.22), rgba(3,9,24,.38)),"
            "url('/static/images/templates/holo_code.png') center / cover no-repeat"
        ),
        "overlay": _grid("#38bdf8", .03),
    },
    {
        "id": "arcade_energy", "name": "Arcade Energy",
        "bg": "#0d0825", "fg": "#f9f2ff",
        "accent": "#ff38d1", "accent2": "#2ecbff", "font": "Orbitron",
        "bg_css": (
            "linear-gradient(rgba(13,8,37,.20), rgba(13,8,37,.36)),"
            "url('/static/images/templates/arcade_energy.png') center / cover no-repeat"
        ),
        "overlay": _grid("#ffffff", .025),
    },
    {
        "id": "code_stream", "name": "Code Stream",
        "bg": "#04122a", "fg": "#e8f2ff",
        "accent": "#00c2ff", "accent2": "#8b5cf6", "font": "JetBrains Mono",
        "bg_css": (
            "linear-gradient(rgba(4,18,42,.22), rgba(4,18,42,.34)),"
            "url('/static/images/templates/code_stream.png') center / cover no-repeat"
        ),
        "overlay": _grid("#38bdf8", .025),
    },
    {
        "id": "fantasy_ruins", "name": "Fantasy Ruins",
        "bg": "#f3e8c7", "fg": "#2f2a1b",
        "accent": "#5eead4", "accent2": "#c084fc", "font": "Lora",
        "bg_css": (
            "linear-gradient(rgba(255,250,235,.10), rgba(255,250,235,.16)),"
            "url('/static/images/templates/fantasy_ruins.png') center / cover no-repeat"
        ),
        "overlay": _dots("#fff7ed", .04),
    },
    {
        "id": "holo_code", "name": "Holo Code",
        "bg": "#030918", "fg": "#e6f2ff",
        "accent": "#00c2ff", "accent2": "#8b5cf6", "font": "JetBrains Mono",
        "bg_css": (
            "linear-gradient(rgba(3,9,24,.22), rgba(3,9,24,.38)),"
            "url('/static/images/templates/holo_code.png') center / cover no-repeat"
        ),
        "overlay": _grid("#38bdf8", .03),
    },
    {
        "id": "music_wave", "name": "Music Wave",
        "bg": "#18052f", "fg": "#fff7ff",
        "accent": "#ff4fd8", "accent2": "#45caff", "font": "Poppins",
        "bg_css": (
            "linear-gradient(rgba(24,5,47,.18), rgba(24,5,47,.26)),"
            "url('/static/images/templates/music_wave.png') center / cover no-repeat"
        ),
        "overlay": _dots("#ffffff", .022),
    },
    {
        "id": "game_controls", "name": "Game Controls",
        "bg": "#0d0a2f", "fg": "#f7f4ff",
        "accent": "#f42fdb", "accent2": "#25c5ff", "font": "Orbitron",
        "bg_css": (
            "linear-gradient(rgba(13,10,47,.20), rgba(13,10,47,.32)),"
            "url('/static/images/templates/game_controls.png') center / cover no-repeat"
        ),
        "overlay": _grid("#ffffff", .022),
    },
    {
        "id": "space_hud", "name": "Space HUD",
        "bg": "#090f2f", "fg": "#eef4ff",
        "accent": "#9d4edd", "accent2": "#38bdf8", "font": "Orbitron",
        "bg_css": (
            "linear-gradient(rgba(9,15,47,.18), rgba(9,15,47,.30)),"
            "url('/static/images/templates/space_hud.png') center / cover no-repeat"
        ),
        "overlay": _dots("#ffffff", .018),
    },
    {
        "id": "space_station", "name": "Space Station",
        "bg": "#060b1f", "fg": "#f5f7ff",
        "accent": "#8b5cf6", "accent2": "#38bdf8", "font": "Orbitron",
        "bg_css": (
            "linear-gradient(rgba(6,11,31,.18), rgba(6,11,31,.34)),"
            "url('/static/images/templates/space_station.png') center / cover no-repeat"
        ),
        "overlay": _grid("#8ab4ff", .03),
    },
    {
        "id": "voxel_world", "name": "Voxel World",
        "bg": "#dff3ff", "fg": "#17324d",
        "accent": "#67c23a", "accent2": "#22a6f2", "font": "Poppins",
        "bg_css": (
            "linear-gradient(rgba(255,255,255,.07), rgba(255,255,255,.07)),"
            "url('/static/images/templates/voxel_world.png') center / cover no-repeat"
        ),
        "overlay": _dots("#ffffff", .03),
    },
]
# Backward compatibility: keep old IDs working for questionnaires already saved.
_TEMPLATE_ALIASES = {
    "midnight": "neon_geometry",
    "sunset": "sunset_bloom",
    "neon": "retro_arcade",
    "paper": "soft_paper",
    "minimal": "minimal_white",
    "ocean": "ocean_depth",
    "forest": "forest_cabin",
    "candy": "purple_motion",
    "corporate": "corporate_blue",
    "retro": "retro_arcade",
    "sakura": "sakura_bloom",
    "mint": "mint_leaves",
    "blueprint": "blueprint_grid",
    "obsidian": "obsidian_gold",
    "space_hud": "space_station",
    "neon_gaming": "arcade_energy",
    "code_matrix": "holo_code",
}


def get_template(template_id: str) -> dict:
    lookup_id = _TEMPLATE_ALIASES.get(template_id, template_id)
    for template in TEMPLATES:
        if template["id"] == lookup_id:
            return template
    return TEMPLATES[0]
