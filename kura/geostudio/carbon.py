"""
kura/geostudio/carbon.py — carbon & solar estimates for MRV dashboards.

READ THIS BEFORE SELLING A CREDIT
─────────────────────────────────
These are *screening* numbers: indicative, IPCC Tier-1-style defaults that
let a project owner see roughly what an area is worth before paying for a
validation. A registry (Verra VCS, Gold Standard, Plan Vivo…) will only issue
credits against an approved methodology, field plots, a baseline, leakage and
permanence buffers, and a third-party validator (VVB). Every factor below can
be overridden per asset from the Studio, and every report says which value
was used, so the numbers are traceable rather than magic.

Typical methodologies people pair with these ecosystems are listed so the
report points the reader in the right direction — they are hints, not
endorsements.
"""

from __future__ import annotations

# tCO2e per hectare per year (net removals, early growth phase) and
# t biomass carbon per hectare at maturity — deliberately conservative.
ECOSYSTEMS = {
    "mangrove": {
        "label": "Mangrove restoration", "icon": "🌿", "color": "#10b981",
        "seq_t_ha_yr": 6.4, "stock_tc_ha": 150.0, "trees_per_ha": 2500,
        "methodology": "Verra VM0033 (Tidal Wetland & Seagrass Restoration)",
    },
    "palm": {
        "label": "Palm / tree-crop planting", "icon": "🌴", "color": "#84cc16",
        "seq_t_ha_yr": 3.0, "stock_tc_ha": 40.0, "trees_per_ha": 143,
        "methodology": "CDM AR-ACM0003 (Afforestation & Reforestation)",
    },
    "forest": {
        "label": "Native forest regrowth", "icon": "🌳", "color": "#16a34a",
        "seq_t_ha_yr": 9.0, "stock_tc_ha": 120.0, "trees_per_ha": 1100,
        "methodology": "CDM AR-ACM0003 / Verra VM0047 (ARR)",
    },
    "agroforestry": {
        "label": "Agroforestry", "icon": "🌾", "color": "#ca8a04",
        "seq_t_ha_yr": 4.0, "stock_tc_ha": 35.0, "trees_per_ha": 400,
        "methodology": "Plan Vivo / Verra VM0047 (ARR)",
    },
    "cashew": {
        "label": "Cashew / orchard", "icon": "🥜", "color": "#f59e0b",
        "seq_t_ha_yr": 3.5, "stock_tc_ha": 30.0, "trees_per_ha": 100,
        "methodology": "CDM AR-ACM0003",
    },
    "solar": {
        "label": "Solar PV (avoided emissions)", "icon": "☀️", "color": "#38bdf8",
        "seq_t_ha_yr": 0.0, "stock_tc_ha": 0.0, "trees_per_ha": 0,
        "methodology": "Gold Standard / CDM AMS-I.D (grid-connected renewable)",
    },
}

# Solar defaults for The Gambia — editable per asset.
SOLAR = {
    "kwp_per_m2": 0.20,          # ~20 % efficient modules at STC
    "yield_kwh_kwp_yr": 1650,    # Sahel/West-Africa coastal ballpark
    "grid_ef_t_mwh": 0.65,       # HFO-heavy grid emission factor (tCO2/MWh)
    "performance_ratio": 0.80,
}

CO2_PER_C = 44.0 / 12.0
DEFAULT_BUFFER = 0.20            # 20 % non-permanence / uncertainty buffer


def ecosystem_choices():
    return [(k, v["label"]) for k, v in ECOSYSTEMS.items()]


def estimate(ecosystem, hectares, years=1.0, canopy_fraction=None, overrides=None,
             panel_area_m2=None, price_usd=None):
    """Return a fully explained estimate dict (every input echoed back)."""
    eco = dict(ECOSYSTEMS.get(ecosystem) or ECOSYSTEMS["forest"])
    o = overrides or {}
    seq = float(o.get("seq_t_ha_yr", eco["seq_t_ha_yr"]))
    buffer = float(o.get("buffer", DEFAULT_BUFFER))
    ha = max(0.0, float(hectares or 0))
    years = max(0.0, float(years or 0))
    # Only the canopy actually seen on the imagery counts, when we have it.
    effective_ha = ha * (canopy_fraction if canopy_fraction is not None else 1.0)

    out = {
        "ecosystem": ecosystem, "label": eco["label"], "methodology_hint": eco["methodology"],
        "hectares": round(ha, 4), "effective_hectares": round(effective_ha, 4),
        "canopy_fraction": None if canopy_fraction is None else round(canopy_fraction, 4),
        "years": years, "seq_t_ha_yr": seq, "buffer": buffer,
        "expected_trees": int(round(ha * eco["trees_per_ha"])),
    }
    if ecosystem == "solar":
        s = dict(SOLAR, **{k: float(v) for k, v in o.items() if k in SOLAR})
        area = float(panel_area_m2 or 0)
        kwp = area * s["kwp_per_m2"]
        mwh = kwp * s["yield_kwh_kwp_yr"] * s["performance_ratio"] / 1000.0
        gross = mwh * s["grid_ef_t_mwh"] * years
        out.update({"panel_area_m2": round(area, 1), "kwp": round(kwp, 1), "mwh_yr": round(mwh, 1),
                    "grid_ef_t_mwh": s["grid_ef_t_mwh"], "yield_kwh_kwp_yr": s["yield_kwh_kwp_yr"]})
    else:
        gross = effective_ha * seq * years
        out["standing_stock_tco2e"] = round(effective_ha * eco["stock_tc_ha"] * CO2_PER_C, 1)
    net = gross * (1 - buffer)
    out.update({"gross_tco2e": round(gross, 2), "buffer_tco2e": round(gross - net, 2),
                "net_tco2e": round(net, 2), "credits": int(net)})  # 1 credit = 1 tCO2e
    if price_usd:
        out["price_usd"] = float(price_usd)
        out["value_usd"] = round(int(net) * float(price_usd), 2)
    return out
