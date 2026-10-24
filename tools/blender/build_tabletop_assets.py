"""
Knock-Knock Tabletop — Blender asset builder.

Models every 3D asset the Live Tables mode and the Hero Forge avatars use,
from code, and exports two GLB files:

    static/tabletop/models/kk_pieces.glb   chess set, dam men & crown,
                                            ludo pawn, die, slash sword
    static/tabletop/models/kk_hero.glb     modular chibi character kit:
                                            body parts, 10 outfits, 9 hair
                                            styles, 11 headwear, 9 props

Everything is original geometry — no imported models, no textures.

Run it with Blender 4.2+ (tested on 5.0):

    blender -b -P tools/blender/build_tabletop_assets.py
    # or, with the `bpy` wheel in a Python 3.11 venv:
    python tools/blender/build_tabletop_assets.py

then commit the two .glb files. three.js (static/js/kk_hero.js and
static/tabletop/js/tt_stage3d.js) clones parts BY OBJECT NAME and recolours
them BY MATERIAL NAME, so if you tweak a model in Blender's UI keep the
names. To restyle: open the .glb in Blender, edit, File > Export > glTF.

Conventions (Blender space, Z up, characters face -Y):
  * Every object sits at the world origin; its mesh is modelled relative
    to the joint it hangs from (see RIG in kk_hero.js). That lets the web
    side animate limbs by rotating pivot groups.
  * Material names are the contract: skin, cloth, trim, pants, boots, hair,
    metal, gold, wood, dark, white, glow, body, accent, pip, string.
"""

import math
import os
import sys

import bpy  # must come first when running as the `bpy` wheel
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "static", "tabletop", "models")

# Placeholder colours only — the browser recolours by material name.
PALETTE = {
    "skin": (0.93, 0.72, 0.55), "cloth": (0.25, 0.45, 0.95), "trim": (0.98, 0.8, 0.2),
    "pants": (0.18, 0.2, 0.3), "boots": (0.25, 0.16, 0.1), "hair": (0.2, 0.12, 0.06),
    "metal": (0.75, 0.78, 0.82), "gold": (1.0, 0.78, 0.2), "wood": (0.55, 0.35, 0.18),
    "dark": (0.06, 0.06, 0.08), "white": (0.97, 0.97, 0.97), "glow": (0.4, 0.95, 1.0),
    "body": (0.92, 0.88, 0.8), "accent": (1.0, 0.78, 0.2), "pip": (0.08, 0.08, 0.1),
    "string": (0.9, 0.9, 0.85),
}


# ───────────────────────────── helpers ─────────────────────────────

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    col = PALETTE.get(name, (0.8, 0.8, 0.8))
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*col, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.35 if name in ("metal", "gold") else 0.6
        bsdf.inputs["Metallic"].default_value = 0.8 if name in ("metal", "gold") else 0.0
    return m


def _obj_from_bm(bm, name, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(material(mat))
    return ob


def sphere(name, r, loc=(0, 0, 0), scale=(1, 1, 1), mat="cloth", seg=24, rings=14):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return _obj_from_bm(bm, name, mat)


def cyl(name, r1, r2, depth, loc=(0, 0, 0), rot=None, mat="cloth", seg=24, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg,
                          radius1=r1, radius2=r2, depth=depth)
    if rot:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                         matrix=Matrix.Rotation(rot[1], 3, rot[0]))
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return _obj_from_bm(bm, name, mat)


def box(name, size, loc=(0, 0, 0), mat="cloth", bevel=0.0, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bevel,
                        segments=3, affect="EDGES", profile=0.5)
    if rot:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                         matrix=Matrix.Rotation(rot[1], 3, rot[0]))
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return _obj_from_bm(bm, name, mat)


def torus(name, R, r, loc=(0, 0, 0), rot=None, mat="gold", seg=32, ring=10, arc=1.0):
    bm = bmesh.new()
    verts_rings = []
    steps = seg if arc >= 1.0 else seg + 1
    for i in range(steps):
        a = 2 * math.pi * arc * i / seg
        ring_v = []
        for j in range(ring):
            b = 2 * math.pi * j / ring
            x = (R + r * math.cos(b)) * math.cos(a)
            y = (R + r * math.cos(b)) * math.sin(a)
            z = r * math.sin(b)
            ring_v.append(bm.verts.new((x, y, z)))
        verts_rings.append(ring_v)
    n = len(verts_rings)
    for i in range(n if arc >= 1.0 else n - 1):
        a_r, b_r = verts_rings[i], verts_rings[(i + 1) % n]
        for j in range(ring):
            bm.faces.new((a_r[j], b_r[j], b_r[(j + 1) % ring], a_r[(j + 1) % ring]))
    if rot:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                         matrix=Matrix.Rotation(rot[1], 3, rot[0]))
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return _obj_from_bm(bm, name, mat)


def lathe(name, profile, mat="body", seg=40, loc=(0, 0, 0)):
    """Spin a (radius, z) profile around Z. Profile runs bottom -> top."""
    bm = bmesh.new()
    prev = None
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * ca, r * sa, z)) for r, z in profile])
    for i in range(seg):
        A, B = rings[i], rings[(i + 1) % seg]
        for j in range(len(profile) - 1):
            if profile[j][0] < 1e-5 and profile[j + 1][0] < 1e-5:
                continue
            bm.faces.new((A[j], B[j], B[j + 1], A[j + 1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj_from_bm(bm, name, mat)


def extrude_poly(name, pts, depth, mat="body", loc=(0, 0, 0), plane="XZ", bevel=0.0):
    """Extrude a 2D outline (in the given plane) by depth, centred."""
    bm = bmesh.new()
    vs = []
    for u, v in pts:
        if plane == "XZ":
            vs.append(bm.verts.new((u, -depth / 2, v)))
        else:  # XY
            vs.append(bm.verts.new((u, v, -depth / 2)))
    f = bm.faces.new(vs)
    vec = (0, depth, 0) if plane == "XZ" else (0, 0, depth)
    res = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector(vec), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2,
                        affect="EDGES", profile=0.5, clamp_overlap=True)
    bmesh.ops.triangulate(bm, faces=[x for x in bm.faces if len(x.verts) > 4])
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return _obj_from_bm(bm, name, mat)


def subdivide(ob, levels=1):
    mod = ob.modifiers.new("sub", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels


def smooth(ob, angle=50):
    for p in ob.data.polygons:
        p.use_smooth = True
    try:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
        ob.select_set(False)
    except Exception:
        pass


def join(name, objs, smooth_angle=50):
    bpy.ops.object.select_all(action="DESELECT")
    # apply modifiers first so subsurf survives the join
    for o in objs:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    bpy.ops.object.select_all(action="DESELECT")
    smooth(ob, smooth_angle)
    return ob


def mirror_x(ob):
    """Duplicate an object mirrored across X, return the copy."""
    c = ob.copy()
    c.data = ob.data.copy()
    bpy.context.scene.collection.objects.link(c)
    c.data.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    c.data.flip_normals()
    return c


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_texcoords=False,
        export_normals=True, export_materials="EXPORT", export_cameras=False,
        export_lights=False, export_animations=False,
    )
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


# ─────────────────────────── board pieces ───────────────────────────

def base_profile(top=0.12):
    return [(0.0, 0.0), (0.37, 0.0), (0.38, 0.03), (0.36, 0.07), (0.31, 0.09),
            (0.3, top - 0.01), (0.25, top)]


def chess_set():
    # Pawn: base, collar, ball head
    pawn = lathe("chess_pawn", base_profile() + [
        (0.17, 0.2), (0.13, 0.36), (0.2, 0.39), (0.2, 0.42), (0.12, 0.45),
        (0.15, 0.49), (0.17, 0.55), (0.16, 0.61), (0.12, 0.66), (0.06, 0.685), (0.0, 0.69)])
    smooth(pawn, 40)

    # Rook: tower with real crenellations
    tower = lathe("rook_tower", base_profile() + [
        (0.22, 0.2), (0.2, 0.55), (0.25, 0.6), (0.27, 0.64), (0.27, 0.8),
        (0.2, 0.8), (0.2, 0.74), (0.0, 0.74)])
    cuts = []
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        cuts.append(box("crenel", (0.13, 0.6, 0.1), loc=(0, 0, 0.78), rot=("Z", a), mat="body"))
    # boolean the notches
    for c in cuts:
        mod = tower.modifiers.new("cut", "BOOLEAN")
        mod.object = c
        mod.operation = "DIFFERENCE"
    bpy.context.view_layer.objects.active = tower
    for m in list(tower.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    for c in cuts:
        bpy.data.objects.remove(c, do_unlink=True)
    band = torus("rook_band", 0.215, 0.025, loc=(0, 0, 0.5), mat="accent")
    join("chess_rook", [tower, band], 40)

    # Bishop: mitre with a slash notch and a ball finial
    mitre = lathe("bishop_body", base_profile() + [
        (0.18, 0.2), (0.12, 0.45), (0.21, 0.5), (0.21, 0.53), (0.12, 0.56),
        (0.17, 0.66), (0.17, 0.74), (0.12, 0.84), (0.05, 0.89), (0.0, 0.9)])
    notch = box("notch", (0.4, 0.05, 0.12), loc=(0.07, 0, 0.77), rot=("Y", math.radians(-40)))
    mod = mitre.modifiers.new("cut", "BOOLEAN")
    mod.object = notch
    mod.operation = "DIFFERENCE"
    bpy.context.view_layer.objects.active = mitre
    bpy.ops.object.modifier_apply(modifier="cut")
    bpy.data.objects.remove(notch, do_unlink=True)
    ball = sphere("bishop_ball", 0.05, loc=(0, 0, 0.93), mat="accent")
    join("chess_bishop", [mitre, ball], 40)

    # Queen: flared crown with a ring of pearls
    q = lathe("queen_body", base_profile() + [
        (0.2, 0.2), (0.13, 0.55), (0.22, 0.6), (0.22, 0.63), (0.13, 0.66),
        (0.16, 0.8), (0.25, 0.92), (0.22, 0.94), (0.1, 0.95), (0.0, 0.96)])
    pearls = [sphere("pearl", 0.035, loc=(0.24 * math.cos(a), 0.24 * math.sin(a), 0.95), mat="accent", seg=10, rings=6)
              for a in [i * 2 * math.pi / 9 for i in range(9)]]
    top = sphere("queen_top", 0.06, loc=(0, 0, 1.0), mat="accent")
    join("chess_queen", [q] + pearls + [top], 40)

    # King: tall body, cross on top
    k = lathe("king_body", base_profile() + [
        (0.21, 0.2), (0.14, 0.6), (0.23, 0.65), (0.23, 0.68), (0.14, 0.71),
        (0.18, 0.86), (0.22, 0.96), (0.15, 0.99), (0.06, 1.02), (0.0, 1.03)])
    cross_v = box("cross_v", (0.06, 0.06, 0.24), loc=(0, 0, 1.13), mat="accent", bevel=0.01)
    cross_h = box("cross_h", (0.18, 0.06, 0.06), loc=(0, 0, 1.15), mat="accent", bevel=0.01)
    join("chess_king", [k, cross_v, cross_h], 40)

    # Knight: lathe base + extruded, bevelled horse head (faces -Y)
    kb = lathe("knight_base", base_profile() + [(0.22, 0.18), (0.2, 0.22), (0.0, 0.22)])
    head_pts = [  # (y-ish forward as -x in profile, z) outline, faces toward -X then rotated
        (0.17, 0.2), (0.2, 0.42), (0.16, 0.6), (0.1, 0.74), (0.04, 0.8), (0.0, 0.86),
        (-0.04, 0.82), (-0.12, 0.76), (-0.26, 0.66), (-0.3, 0.6), (-0.27, 0.54),
        (-0.18, 0.55), (-0.08, 0.5), (-0.12, 0.38), (-0.16, 0.2)]
    head = extrude_poly("knight_head", head_pts, 0.26, mat="body", bevel=0.06)
    head.data.transform(Matrix.Rotation(math.radians(90), 4, "Z"))  # muzzle toward -Y
    ear = cyl("knight_ear", 0.05, 0.0, 0.14, loc=(0, 0.03, 0.9), mat="body", seg=8)
    mane = [sphere("mane", 0.045, loc=(0, 0.11 + 0.02 * i, 0.78 - 0.1 * i), mat="accent", seg=10, rings=6) for i in range(4)]
    join("chess_knight", [kb, head, ear] + mane, 35)


def dam_and_ludo():
    # Dam man: chunky ridged disc
    prof = [(0.0, 0.0), (0.38, 0.0), (0.4, 0.02), (0.4, 0.1), (0.38, 0.12),
            (0.3, 0.125), (0.28, 0.14), (0.0, 0.14)]
    disc = lathe("dam_disc", prof, mat="body", seg=48)
    ring = torus("dam_ring", 0.24, 0.022, loc=(0, 0, 0.13), mat="accent", seg=40, ring=8)
    join("dam_man", [disc, ring], 35)

    # Crown placed on a king
    band = cyl("crown_band", 0.27, 0.29, 0.12, loc=(0, 0, 0.06), mat="gold", seg=40, cap=False)
    sol = band.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = 0.03
    spikes = []
    for i in range(6):
        a = i * math.pi / 3
        spikes.append(cyl("spike", 0.05, 0.0, 0.14, loc=(0.28 * math.cos(a), 0.28 * math.sin(a), 0.19), mat="gold", seg=8))
        spikes.append(sphere("jewel", 0.03, loc=(0.28 * math.cos(a), 0.28 * math.sin(a), 0.27), mat="glow", seg=8, rings=6))
    join("dam_crown", [band] + spikes, 30)

    # Ludo pawn: peg body + head + collar
    body = lathe("ludo_body", [(0.0, 0.0), (0.26, 0.0), (0.27, 0.03), (0.24, 0.07), (0.2, 0.1),
                               (0.14, 0.3), (0.11, 0.42), (0.0, 0.42)], mat="body")
    collar = torus("ludo_collar", 0.12, 0.03, loc=(0, 0, 0.42), mat="accent", seg=24, ring=8)
    head = sphere("ludo_head", 0.15, loc=(0, 0, 0.56), mat="body")
    join("ludo_pawn", [body, collar, head], 50)

    # Die: rounded cube, pips as dark beads. Blender faces: +Z1 -Z6 +X3 -X4 +Y2 -Y5
    die = box("die_body", (0.5, 0.5, 0.5), mat="white", bevel=0.07)
    pips = []
    s = 0.13
    layouts = {1: [(0, 0)], 2: [(-s, -s), (s, s)], 3: [(-s, -s), (0, 0), (s, s)],
               4: [(-s, -s), (s, -s), (-s, s), (s, s)],
               5: [(-s, -s), (s, -s), (0, 0), (-s, s), (s, s)],
               6: [(-s, -s), (s, -s), (-s, 0), (s, 0), (-s, s), (s, s)]}
    faces = {1: ("Z", 1), 6: ("Z", -1), 3: ("X", 1), 4: ("X", -1), 2: ("Y", 1), 5: ("Y", -1)}
    for v, (ax, sign) in faces.items():
        for u, w in layouts[v]:
            if ax == "Z":
                p = (u, w, sign * 0.25)
            elif ax == "X":
                p = (sign * 0.25, u, w)
            else:
                p = (u, sign * 0.25, w)
            pips.append(sphere("pip", 0.045, loc=p, scale=(1, 1, 1), mat="pip", seg=10, rings=6))
    join("die", [die] + pips, 30)

    # Slash sword used for captures: blade, guard, grip, pommel (along +Z)
    blade = extrude_poly("sword_blade", [(-0.05, 0.0), (0.05, 0.0), (0.05, 0.75), (0.0, 0.9), (-0.05, 0.75)],
                         0.025, mat="metal", bevel=0.008)
    edge = extrude_poly("sword_edge", [(-0.012, 0.02), (0.012, 0.02), (0.012, 0.74), (0.0, 0.84), (-0.012, 0.74)],
                        0.03, mat="glow")
    guard = box("guard", (0.3, 0.07, 0.05), loc=(0, 0, -0.02), mat="gold", bevel=0.02)
    grip = cyl("grip", 0.03, 0.03, 0.2, loc=(0, 0, -0.14), mat="wood", seg=12)
    pommel = sphere("pommel", 0.045, loc=(0, 0, -0.26), mat="gold", seg=12, rings=8)
    join("fx_sword", [blade, edge, guard, grip, pommel], 30)


# ─────────────────────────── hero kit ───────────────────────────
# Joint positions (Blender coords). Mirror of RIG in static/js/kk_hero.js.
HIP = (0.16, 0.0, 0.55)
TORSO = (0.0, 0.0, 0.55)
NECK = (0.0, 0.0, 1.08)
SHOULDER = (0.33, 0.0, 0.98)
HEAD_C = 0.42   # head centre height above NECK
HEAD_R = 0.42


def hero_body():
    # Torso (origin at TORSO): soft egg
    t = sphere("hero_torso", 0.3, loc=(0, 0, 0.27), scale=(1.0, 0.8, 1.05), mat="cloth")
    subdivide(t, 1)
    join("hero_torso", [t])

    # Head (origin at NECK): big sphere, little neck
    neck = cyl("neck", 0.1, 0.1, 0.12, loc=(0, 0, 0.02), mat="skin", seg=16)
    head = sphere("head", HEAD_R, loc=(0, 0, HEAD_C), scale=(1.05, 0.98, 0.96), mat="skin", seg=32, rings=20)
    ear_l = sphere("ear", 0.07, loc=(0.42, 0.02, HEAD_C - 0.02), scale=(0.5, 0.9, 1.1), mat="skin", seg=12, rings=8)
    ear_r = sphere("ear", 0.07, loc=(-0.42, 0.02, HEAD_C - 0.02), scale=(0.5, 0.9, 1.1), mat="skin", seg=12, rings=8)
    join("hero_head", [head, neck, ear_l, ear_r], 60)

    # Arm (origin at SHOULDER, hangs down -Z): sleeve + mitten hand
    sleeve = cyl("sleeve", 0.095, 0.08, 0.34, loc=(0, 0, -0.17), mat="cloth", seg=16)
    cap = sphere("shoulder", 0.1, loc=(0, 0, 0), mat="cloth", seg=16, rings=10)
    hand = sphere("hand", 0.095, loc=(0, -0.01, -0.42), scale=(1, 0.85, 1.05), mat="skin", seg=16, rings=10)
    thumb = sphere("thumb", 0.04, loc=(-0.06, -0.06, -0.38), mat="skin", seg=10, rings=6)
    join("hero_arm", [sleeve, cap, hand, thumb], 60)

    # Leg (origin at HIP): trouser + boot that points forward (-Y)
    leg = cyl("leg", 0.11, 0.1, 0.36, loc=(0, 0, -0.16), mat="pants", seg=16)
    boot = sphere("boot", 0.12, loc=(0, -0.05, -0.47), scale=(1.0, 1.45, 0.75), mat="boots", seg=16, rings=10)
    sole = cyl("sole", 0.12, 0.12, 0.03, loc=(0, -0.05, -0.535), mat="dark", seg=16)
    sole.data.transform(Matrix.Scale(1.45, 4, (0, 1, 0)))
    join("hero_leg", [leg, boot, sole], 60)


def hero_outfits():
    # all relative to TORSO pivot
    hood = torus("hood", 0.2, 0.08, loc=(0, 0.1, 0.55), rot=("X", math.radians(70)), mat="cloth", seg=24, ring=10)
    pocket = box("pocket", (0.32, 0.06, 0.14), loc=(0, -0.235, 0.15), mat="trim", bevel=0.03)
    strings = [cyl("str", 0.012, 0.012, 0.16, loc=(x, -0.24, 0.45), mat="string", seg=6) for x in (-0.06, 0.06)]
    join("fit_hoodie", [hood, pocket] + strings)

    chest = sphere("plate", 0.31, loc=(0, -0.03, 0.3), scale=(1.03, 0.85, 0.9), mat="metal")
    pads = [sphere("pad", 0.15, loc=(x, 0, 0.5), scale=(1.1, 1, 0.7), mat="metal", seg=16, rings=10) for x in (-0.3, 0.3)]
    belt = torus("belt", 0.29, 0.035, loc=(0, 0, 0.05), mat="trim", seg=32)
    belt.data.transform(Matrix.Scale(0.82, 4, (0, 1, 0)))
    gem = sphere("gem", 0.05, loc=(0, -0.3, 0.32), mat="glow", seg=12, rings=8)
    join("fit_armor", [chest, belt, gem] + pads)

    skirt = cyl("skirt", 0.26, 0.4, 0.55, loc=(0, 0, -0.2), mat="cloth", seg=28, cap=False)
    s2 = skirt.modifiers.new("s", "SOLIDIFY")
    s2.thickness = 0.02
    rope = torus("rope", 0.29, 0.03, loc=(0, 0, 0.08), mat="trim", seg=28)
    collar = torus("collar", 0.16, 0.05, loc=(0, 0, 0.53), mat="trim", seg=24)
    stars = [sphere("star", 0.03, loc=(0.3 * math.cos(a), 0.3 * math.sin(a), -0.15), mat="gold", seg=8, rings=6)
             for a in [i * 2 * math.pi / 7 for i in range(7)]]
    join("fit_robe", [skirt, rope, collar] + stars)

    lap_l = extrude_poly("lapel", [(0.0, 0.55), (0.12, 0.52), (0.04, 0.2)], 0.03, mat="cloth")
    lap_l.data.transform(Matrix.Translation((0.02, -0.24, 0.0)))
    lap_r = mirror_x(lap_l)
    shirt = extrude_poly("shirt", [(-0.08, 0.53), (0.08, 0.53), (0.0, 0.22)], 0.02, mat="white")
    shirt.data.transform(Matrix.Translation((0, -0.235, 0)))
    tie = extrude_poly("tie", [(-0.025, 0.5), (0.025, 0.5), (0.04, 0.28), (0.0, 0.22), (-0.04, 0.28)], 0.03, mat="trim")
    tie.data.transform(Matrix.Translation((0, -0.255, 0)))
    join("fit_suit", [lap_l, lap_r, shirt, tie], 30)

    # Kaftan / grand boubou: long flowing gown with embroidered neckline
    # flows from the shoulders to the ankles: lathe so it hugs the chest
    gown = lathe("gown", [(0.5, -0.56), (0.47, -0.4), (0.4, -0.1), (0.34, 0.15),
                          (0.33, 0.35), (0.3, 0.48), (0.2, 0.56), (0.14, 0.58)],
                 mat="cloth", seg=36)
    g2 = gown.modifiers.new("s", "SOLIDIFY")
    g2.thickness = 0.02
    emb = torus("emb", 0.15, 0.03, loc=(0, -0.05, 0.5), mat="trim", seg=24)
    emb.data.transform(Matrix.Scale(1.25, 4, (0, 0, 1)))
    panel = extrude_poly("panel", [(-0.07, 0.48), (0.07, 0.48), (0.05, 0.05), (0.0, 0.0), (-0.05, 0.05)], 0.02, mat="trim")
    panel.data.transform(Matrix.Translation((0, -0.245, 0)))
    hem = torus("hem", 0.46, 0.02, loc=(0, 0, -0.55), mat="trim", seg=36, ring=6)
    join("fit_kaftan", [gown, emb, panel, hem])

    collar = torus("vneck", 0.15, 0.03, loc=(0, -0.02, 0.52), mat="trim", seg=24)
    stripe_l = box("stripe", (0.04, 0.5, 0.5), loc=(0.2, 0, 0.27), mat="trim")
    stripe_l.data.transform(Matrix.Scale(1.0, 4))
    num = extrude_poly("num", [(-0.06, 0.4), (0.06, 0.4), (0.06, 0.15), (-0.06, 0.15)], 0.02, mat="white")
    num.data.transform(Matrix.Translation((0, -0.25, 0)))
    bpy.data.objects.remove(stripe_l, do_unlink=True)
    join("fit_jersey", [collar, num])

    pack = box("pack", (0.36, 0.18, 0.4), loc=(0, 0.3, 0.3), mat="metal", bevel=0.05)
    tanks = [cyl("tank", 0.06, 0.06, 0.36, loc=(x, 0.4, 0.32), mat="trim", seg=12) for x in (-0.1, 0.1)]
    ring = torus("ring", 0.18, 0.05, loc=(0, 0, 0.55), mat="metal", seg=28)
    light = sphere("light", 0.04, loc=(0.12, -0.25, 0.4), mat="glow", seg=10, rings=6)
    join("fit_space", [pack, ring, light] + tanks)

    sash = torus("sash", 0.29, 0.04, loc=(0, 0, 0.1), mat="trim", seg=28)
    sash.data.transform(Matrix.Scale(0.82, 4, (0, 1, 0)))
    knot = sphere("knot", 0.06, loc=(0.16, -0.22, 0.1), mat="trim", seg=10, rings=6)
    tails = [box("tail", (0.05, 0.02, 0.22), loc=(0.18 + 0.05 * i, -0.24, -0.04), rot=("Y", 0.2 * i), mat="trim") for i in range(2)]
    scarf = torus("scarf", 0.17, 0.06, loc=(0, 0, 0.53), mat="dark", seg=24)
    join("fit_ninja", [sash, knot, scarf] + tails)

    coat = cyl("coat", 0.3, 0.38, 0.4, loc=(0, 0.04, -0.12), mat="cloth", seg=28, cap=False)
    c2 = coat.modifiers.new("s", "SOLIDIFY")
    c2.thickness = 0.02
    cut = box("cut", (0.25, 0.4, 0.5), loc=(0, -0.3, -0.12), mat="cloth")
    m = coat.modifiers.new("cut", "BOOLEAN")
    m.object = cut
    m.operation = "DIFFERENCE"
    bpy.context.view_layer.objects.active = coat
    for mod in list(coat.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cut, do_unlink=True)
    belt = torus("pbelt", 0.3, 0.04, loc=(0, 0, 0.08), mat="dark", seg=28)
    belt.data.transform(Matrix.Scale(0.82, 4, (0, 1, 0)))
    buckle = box("buckle", (0.1, 0.03, 0.08), loc=(0, -0.255, 0.08), mat="gold", bevel=0.01)
    btns = [sphere("btn", 0.025, loc=(x, -0.245, z), mat="gold", seg=8, rings=6) for x in (-0.09, 0.09) for z in (0.25, 0.38)]
    join("fit_pirate", [coat, belt, buckle] + btns)

    bib = box("bib", (0.3, 0.05, 0.24), loc=(0, -0.245, 0.27), mat="pants", bevel=0.03)
    straps = [box("strap", (0.05, 0.42, 0.04), loc=(x, 0, 0.5), mat="pants") for x in (-0.11, 0.11)]
    buttons = [sphere("ob", 0.028, loc=(x, -0.275, 0.36), mat="gold", seg=8, rings=6) for x in (-0.11, 0.11)]
    pock = box("opock", (0.13, 0.02, 0.09), loc=(0, -0.275, 0.25), mat="trim", bevel=0.01)
    join("fit_overalls", [bib, pock] + straps + buttons)


def hero_hair():
    c = HEAD_C
    # spiky: cones in a crown
    spikes = []
    for i in range(9):
        a = i * 2 * math.pi / 9
        tilt = 0.6
        x, y = 0.25 * math.cos(a), 0.25 * math.sin(a) + 0.05
        sp = cyl("spike", 0.12, 0.0, 0.3, loc=(0, 0, 0.15), mat="hair", seg=8)
        sp.data.transform(Matrix.Rotation(tilt, 4, Vector((-math.sin(a), math.cos(a), 0))))
        sp.data.transform(Matrix.Translation((x, y, c + 0.28)))
        spikes.append(sp)
    cap = sphere("cap", HEAD_R + 0.02, loc=(0, 0.03, c + 0.05), scale=(1.04, 1.0, 0.85), mat="hair")
    top = cyl("top", 0.13, 0.0, 0.36, loc=(0, 0.05, c + 0.55), mat="hair", seg=8)
    join("hair_spiky", [cap, top] + spikes, 30)

    bob = sphere("bob", HEAD_R + 0.05, loc=(0, 0.05, c - 0.02), scale=(1.08, 1.05, 1.0), mat="hair")
    fringe = box("cutter", (1.2, 0.6, 0.55), loc=(0, -0.42, c - 0.18), mat="hair")
    m = bob.modifiers.new("cut", "BOOLEAN")
    m.object = fringe
    m.operation = "DIFFERENCE"
    bpy.context.view_layer.objects.active = bob
    bpy.ops.object.modifier_apply(modifier="cut")
    bpy.data.objects.remove(fringe, do_unlink=True)
    join("hair_bob", [bob], 60)

    longh = sphere("long", HEAD_R + 0.04, loc=(0, 0.06, c + 0.02), scale=(1.06, 1.04, 1.0), mat="hair")
    cutter = box("cutter", (1.2, 0.6, 0.6), loc=(0, -0.43, c - 0.12), mat="hair")
    m = longh.modifiers.new("cut", "BOOLEAN")
    m.object = cutter
    m.operation = "DIFFERENCE"
    bpy.context.view_layer.objects.active = longh
    bpy.ops.object.modifier_apply(modifier="cut")
    bpy.data.objects.remove(cutter, do_unlink=True)
    back = box("back", (0.72, 0.2, 0.75), loc=(0, 0.25, c - 0.45), mat="hair", bevel=0.09)
    join("hair_long", [longh, back], 60)

    puffs = [sphere("afro", 0.2, loc=(0.36 * math.cos(a) * math.sin(b), 0.36 * math.sin(a) * math.sin(b) + 0.04, c + 0.05 + 0.36 * math.cos(b)), mat="hair", seg=12, rings=8)
             for b in (0.35, 0.95, 1.45) for a in [i * 2 * math.pi / (6 if b > 0.4 else 3) for i in range(6 if b > 0.4 else 3)]]
    base = sphere("afrobase", HEAD_R + 0.08, loc=(0, 0.06, c + 0.12), scale=(1.1, 1.05, 1.0), mat="hair")
    join("hair_afro", [base] + puffs, 70)

    cap = sphere("cap", HEAD_R + 0.02, loc=(0, 0.04, c + 0.05), scale=(1.03, 1.0, 0.88), mat="hair")
    bun = sphere("bun", 0.17, loc=(0, 0.12, c + 0.5), mat="hair")
    tie = torus("tie", 0.11, 0.03, loc=(0, 0.1, c + 0.38), mat="trim", seg=20)
    join("hair_bun", [cap, bun, tie], 60)

    fins = []
    for i in range(6):
        z = c + 0.38 - 0.0 * i
        f = cyl("fin", 0.08, 0.0, 0.28, loc=(0, -0.2 + 0.11 * i, z + 0.12 - abs(i - 2.2) * 0.04), mat="hair", seg=6)
        f.data.transform(Matrix.Scale(0.4, 4, (1, 0, 0)))
        fins.append(f)
    shaved = sphere("shaved", HEAD_R + 0.005, loc=(0, 0.02, c + 0.03), scale=(1.0, 1.0, 0.9), mat="hair")
    shaved.data.transform(Matrix.Scale(1.0, 4))
    join("hair_mohawk", fins, 30)
    bpy.data.objects.remove(shaved, do_unlink=True)

    cap = sphere("cap", HEAD_R + 0.025, loc=(0, 0.04, c + 0.04), scale=(1.04, 1.02, 0.9), mat="hair")
    braids = []
    for sx in (-1, 1):
        for k in range(5):
            braids.append(sphere("b", 0.075 - 0.006 * k, loc=(sx * 0.33, 0.12, c - 0.15 - 0.13 * k), mat="hair", seg=10, rings=6))
        braids.append(sphere("bead", 0.045, loc=(sx * 0.33, 0.12, c - 0.8), mat="trim", seg=10, rings=6))
    join("hair_braids", [cap] + braids, 70)

    cap = sphere("cap", HEAD_R + 0.025, loc=(0, 0.04, c + 0.04), scale=(1.04, 1.02, 0.9), mat="hair")
    tail = [sphere("tail", 0.12 - 0.012 * k, loc=(0, 0.42 + 0.03 * k, c + 0.1 - 0.13 * k), scale=(1, 1, 1.3), mat="hair", seg=12, rings=8) for k in range(5)]
    band = torus("pband", 0.07, 0.025, loc=(0, 0.42, c + 0.2), rot=("X", 1.2), mat="trim", seg=16)
    join("hair_ponytail", [cap, band] + tail, 70)

    curls = [sphere("curl", 0.11, loc=(0.3 * math.cos(a), 0.3 * math.sin(a) + 0.02, c + 0.3 + 0.05 * math.sin(3 * a)), mat="hair", seg=10, rings=8)
             for a in [i * 2 * math.pi / 11 for i in range(11)]]
    curls += [sphere("curl", 0.12, loc=(0.12 * math.cos(a), 0.12 * math.sin(a), c + 0.42), mat="hair", seg=10, rings=8) for a in (0, 2.1, 4.2)]
    cap = sphere("cap", HEAD_R + 0.02, loc=(0, 0.04, c + 0.04), scale=(1.03, 1.0, 0.86), mat="hair")
    join("hair_curly", [cap] + curls, 70)


def hero_hats():
    c = HEAD_C
    top = c + HEAD_R * 0.8
    # crown
    band = cyl("cband", 0.26, 0.29, 0.16, loc=(0, 0, top + 0.06), mat="gold", seg=32, cap=False)
    s = band.modifiers.new("s", "SOLIDIFY")
    s.thickness = 0.03
    pts = []
    for i in range(5):
        a = i * 2 * math.pi / 5
        pts.append(cyl("pt", 0.06, 0.0, 0.16, loc=(0.27 * math.cos(a), 0.27 * math.sin(a), top + 0.21), mat="gold", seg=8))
        pts.append(sphere("j", 0.035, loc=(0.27 * math.cos(a), 0.27 * math.sin(a), top + 0.3), mat="glow", seg=8, rings=6))
    gem = sphere("gem", 0.05, loc=(0, -0.29, top + 0.06), mat="glow", seg=10, rings=8)
    join("hat_crown", [band, gem] + pts, 30)

    dome = sphere("dome", HEAD_R + 0.03, loc=(0, 0.02, c + 0.05), scale=(1.03, 1.03, 0.85), mat="cloth")
    cut = box("cut", (1.5, 1.5, 0.8), loc=(0, 0, c - 0.15), mat="cloth")
    m = dome.modifiers.new("c", "BOOLEAN")
    m.object = cut
    m.operation = "DIFFERENCE"
    bpy.context.view_layer.objects.active = dome
    bpy.ops.object.modifier_apply(modifier="c")
    bpy.data.objects.remove(cut, do_unlink=True)
    brim = cyl("brim", 0.24, 0.24, 0.03, loc=(0, -0.38, c + 0.25), mat="trim", seg=24)
    brim.data.transform(Matrix.Translation((0, 0, 0)))
    btn = sphere("btn", 0.05, loc=(0, 0.02, c + 0.43), mat="trim", seg=10, rings=6)
    join("hat_cap", [dome, brim, btn], 40)

    cone = cyl("wcone", 0.42, 0.0, 0.9, loc=(0, 0.05, top + 0.42), mat="cloth", seg=24)
    cone.data.transform(Matrix.Rotation(-0.25, 4, "X"))
    brim = cyl("wbrim", 0.62, 0.62, 0.04, loc=(0, 0.02, top), mat="cloth", seg=32)
    band = torus("wband", 0.4, 0.04, loc=(0, 0.02, top + 0.06), mat="trim", seg=28)
    star = sphere("wstar", 0.06, loc=(0.1, -0.33, top + 0.3), mat="gold", seg=8, rings=6)
    join("hat_wizard", [cone, brim, band, star], 30)

    helm = sphere("helm", HEAD_R + 0.06, loc=(0, 0, c + 0.04), mat="metal", seg=32, rings=18)
    visor = box("vcut", (0.6, 0.4, 0.18), loc=(0, -0.4, c - 0.02), mat="metal")
    m = helm.modifiers.new("c", "BOOLEAN")
    m.object = visor
    m.operation = "DIFFERENCE"
    bpy.context.view_layer.objects.active = helm
    bpy.ops.object.modifier_apply(modifier="c")
    bpy.data.objects.remove(visor, do_unlink=True)
    plume = [sphere("pl", 0.07, loc=(0, 0.05 + 0.08 * k, top + 0.18 + 0.03 * math.sin(k)), mat="trim", seg=10, rings=6) for k in range(5)]
    ridge = box("ridge", (0.05, 0.7, 0.06), loc=(0, 0.0, top + 0.1), mat="gold", bevel=0.02)
    join("hat_helmet", [helm, ridge] + plume, 40)

    # Kufi: round brimless cap with embroidered band
    kufi = cyl("kufi", 0.37, 0.39, 0.22, loc=(0, 0.02, top - 0.02), mat="cloth", seg=32)
    topd = sphere("ktop", 0.37, loc=(0, 0.02, top + 0.09), scale=(1, 1, 0.25), mat="cloth", seg=32, rings=10)
    band = torus("kband", 0.385, 0.025, loc=(0, 0.02, top - 0.06), mat="trim", seg=36, ring=6)
    dots = [sphere("kd", 0.025, loc=(0.385 * math.cos(a), 0.02 + 0.385 * math.sin(a), top + 0.05), mat="trim", seg=6, rings=4)
            for a in [i * 2 * math.pi / 16 for i in range(16)]]
    join("hat_kufi", [kufi, topd, band] + dots, 40)

    # Headwrap (tie / musoro): wrapped folds + knot fan on top
    wraps = [torus("wrap", 0.34 - 0.04 * k, 0.08, loc=(0, 0.03, top - 0.05 + 0.1 * k), rot=("X", 0.18 * (k % 2) - 0.09), mat="cloth", seg=28, ring=10) for k in range(4)]
    fan = [sphere("fan", 0.13, loc=(0.12 * math.cos(a), 0.05 + 0.12 * math.sin(a) * 0.3, top + 0.42), scale=(1.0, 0.5, 1.2), mat="trim", seg=12, rings=8) for a in (0.4, 1.57, 2.74)]
    join("hat_wrap", wraps + fan, 60)

    band = torus("hband", HEAD_R + 0.05, 0.035, loc=(0, 0, c + 0.05), rot=("Y", math.pi / 2), mat="dark", seg=32, arc=0.5)
    band.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    band.data.transform(Matrix.Rotation(math.pi / 2, 4, "Z"))
    cups = [cyl("cup", 0.13, 0.13, 0.1, loc=(x, 0, c), rot=("Y", math.pi / 2), mat="dark", seg=20) for x in (-0.46, 0.46)]
    pads = [cyl("pad", 0.1, 0.1, 0.02, loc=(x, 0, c), rot=("Y", math.pi / 2), mat="glow", seg=20) for x in (-0.52, 0.52)]
    mic = cyl("mic", 0.015, 0.015, 0.3, loc=(-0.4, -0.2, c - 0.15), rot=("Z", 0.0), mat="dark", seg=6)
    mic.data.transform(Matrix.Rotation(1.2, 4, "X"))
    join("hat_phones", [band] + cups + pads + [mic], 40)

    helm = sphere("vhelm", HEAD_R + 0.05, loc=(0, 0.02, c + 0.08), scale=(1, 1, 0.8), mat="metal", seg=28, rings=14)
    cut = box("cut", (1.5, 1.5, 0.8), loc=(0, 0, c - 0.25), mat="metal")
    m = helm.modifiers.new("c", "BOOLEAN")
    m.object = cut
    m.operation = "DIFFERENCE"
    bpy.context.view_layer.objects.active = helm
    bpy.ops.object.modifier_apply(modifier="c")
    bpy.data.objects.remove(cut, do_unlink=True)
    horns = []
    for sx in (-1, 1):
        h = torus("horn", 0.2, 0.05, loc=(0, 0, 0), rot=("Y", math.pi / 2), mat="white", seg=16, ring=8, arc=0.35)
        h.data.transform(Matrix.Translation((sx * 0.38, 0, c + 0.12)))
        if sx < 0:
            h.data.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
            h.data.flip_normals()
        horns.append(h)
    rim = torus("vrim", HEAD_R + 0.05, 0.03, loc=(0, 0.02, c + 0.02), mat="gold", seg=32)
    join("hat_viking", [helm, rim] + horns, 40)

    halo = torus("halo", 0.3, 0.035, loc=(0, 0.05, top + 0.32), mat="glow", seg=36)
    join("hat_halo", [halo], 60)

    beanie = sphere("bean", HEAD_R + 0.04, loc=(0, 0.03, c + 0.1), scale=(1.03, 1.02, 0.95), mat="cloth")
    cut = box("cut", (1.5, 1.5, 0.8), loc=(0, 0, c - 0.12), mat="cloth")
    m = beanie.modifiers.new("c", "BOOLEAN")
    m.object = cut
    m.operation = "DIFFERENCE"
    bpy.context.view_layer.objects.active = beanie
    bpy.ops.object.modifier_apply(modifier="c")
    bpy.data.objects.remove(cut, do_unlink=True)
    cuff = torus("cuff", HEAD_R + 0.04, 0.06, loc=(0, 0.03, c + 0.3), mat="trim", seg=32)
    pom = sphere("pom", 0.11, loc=(0, 0.03, c + HEAD_R + 0.2), mat="trim", seg=12, rings=8)
    join("hat_beanie", [beanie, cuff, pom], 60)

    crownc = cyl("tc", 0.28, 0.3, 0.42, loc=(0, 0.02, top + 0.2), mat="dark", seg=28)
    brim = cyl("tb", 0.46, 0.46, 0.04, loc=(0, 0.02, top - 0.01), mat="dark", seg=32)
    ribbon = cyl("rib", 0.305, 0.305, 0.08, loc=(0, 0.02, top + 0.06), mat="trim", seg=28)
    join("hat_top", [crownc, brim, ribbon], 30)


def hero_props():
    # grip at origin, item along +Z
    blade = extrude_poly("blade", [(-0.045, 0.0), (0.045, 0.0), (0.045, 0.55), (0.0, 0.66), (-0.045, 0.55)], 0.02, mat="metal", bevel=0.006)
    guard = box("guard", (0.22, 0.06, 0.04), loc=(0, 0, -0.01), mat="gold", bevel=0.015)
    grip = cyl("grip", 0.025, 0.025, 0.14, loc=(0, 0, -0.09), mat="wood", seg=10)
    pom = sphere("pom", 0.035, loc=(0, 0, -0.18), mat="gold", seg=10, rings=6)
    join("prop_sword", [blade, guard, grip, pom], 30)

    shaft = cyl("shaft", 0.025, 0.03, 1.2, loc=(0, 0, 0.2), mat="wood", seg=10)
    orb = sphere("orb", 0.09, loc=(0, 0, 0.88), mat="glow", seg=16, rings=10)
    claw = [cyl("claw", 0.02, 0.0, 0.16, loc=(0.06 * math.cos(a), 0.06 * math.sin(a), 0.84), mat="gold", seg=6) for a in (0, 2.1, 4.2)]
    join("prop_staff", [shaft, orb] + claw, 40)

    shield = cyl("shield", 0.3, 0.3, 0.05, loc=(0, 0, 0), rot=("Y", math.pi / 2), mat="trim", seg=32)
    boss = sphere("boss", 0.09, loc=(0.04, 0, 0), scale=(0.6, 1, 1), mat="metal", seg=16, rings=10)
    rim = torus("rim", 0.3, 0.03, loc=(0, 0, 0), rot=("Y", math.pi / 2), mat="metal", seg=36)
    join("prop_shield", [shield, boss, rim], 40)

    handle = cyl("handle", 0.03, 0.03, 0.55, loc=(0, 0, 0.12), mat="wood", seg=10)
    head = box("hhead", (0.32, 0.18, 0.18), loc=(0, 0, 0.42), mat="metal", bevel=0.03)
    band = box("hband", (0.06, 0.19, 0.19), loc=(0, 0, 0.42), mat="gold")
    join("prop_hammer", [handle, head, band], 30)

    body = sphere("gbody", 0.2, loc=(0, 0, -0.05), scale=(1.0, 0.35, 1.2), mat="wood")
    body2 = sphere("gbody2", 0.15, loc=(0, 0, 0.17), scale=(1.0, 0.35, 1.0), mat="wood")
    hole = cyl("ghole", 0.06, 0.06, 0.02, loc=(0, -0.07, 0.02), rot=("X", math.pi / 2), mat="dark", seg=16)
    neck = box("gneck", (0.06, 0.04, 0.45), loc=(0, 0, 0.5), mat="wood")
    headg = box("ghead", (0.09, 0.04, 0.12), loc=(0, 0, 0.77), mat="dark", bevel=0.01)
    join("prop_guitar", [body, body2, hole, neck, headg], 40)

    pad = box("pad", (0.34, 0.1, 0.16), loc=(0, 0, 0), mat="dark", bevel=0.05)
    grips = [sphere("g", 0.08, loc=(x, 0.02, -0.06), mat="dark", seg=12, rings=8) for x in (-0.14, 0.14)]
    btns = [sphere("b", 0.02, loc=(0.1 + dx, -0.05, 0.02 + dz), mat=m_, seg=8, rings=6) for dx, dz, m_ in ((0.03, 0, "glow"), (-0.03, 0, "trim"), (0, 0.03, "white"), (0, -0.03, "gold"))]
    dpad = box("d", (0.07, 0.02, 0.02), loc=(-0.1, -0.05, 0.02), mat="white")
    dpad2 = box("d2", (0.02, 0.02, 0.07), loc=(-0.1, -0.05, 0.02), mat="white")
    join("prop_pad", [pad, dpad, dpad2] + grips + btns, 40)

    wand = cyl("wand", 0.015, 0.02, 0.38, loc=(0, 0, 0.12), mat="dark", seg=8)
    tip = sphere("tip", 0.035, loc=(0, 0, 0.33), mat="glow", seg=10, rings=6)
    star = extrude_poly("wstar", [(0.07 * math.cos(a) * (1 if i % 2 == 0 else 0.45), 0.07 * math.sin(a) * (1 if i % 2 == 0 else 0.45))
                                  for i, a in enumerate([math.pi / 2 + k * math.pi / 5 for k in range(10)])], 0.02, mat="gold", plane="XZ")
    star.data.transform(Matrix.Translation((0, 0, 0.36)))
    join("prop_wand", [wand, tip, star], 30)

    # Kora: calabash resonator, long neck, strings and bridge (West African harp-lute)
    gourd = sphere("gourd", 0.2, loc=(0, 0, -0.1), scale=(1, 0.9, 1), mat="wood", seg=24, rings=14)
    skin = cyl("kskin", 0.17, 0.17, 0.01, loc=(0, -0.17, -0.06), rot=("X", math.pi / 2), mat="white", seg=24)
    neckk = cyl("kneck", 0.025, 0.02, 1.0, loc=(0, -0.05, 0.35), mat="wood", seg=10)
    bridge = box("kbridge", (0.03, 0.03, 0.18), loc=(0, -0.19, 0.03), mat="wood")
    strings = [cyl("ks", 0.004, 0.004, 0.8, loc=(dx, -0.17, 0.4), mat="string", seg=4) for dx in (-0.025, -0.012, 0.0, 0.012, 0.025)]
    handles = [cyl("kh", 0.012, 0.012, 0.18, loc=(sx * 0.09, -0.1, 0.05), rot=("Y", math.pi / 2), mat="wood", seg=6) for sx in (-1, 1)]
    join("prop_kora", [gourd, skin, neckk, bridge] + strings + handles, 40)

    cup = lathe("cup", [(0.0, 0.0), (0.12, 0.0), (0.12, 0.03), (0.04, 0.06), (0.03, 0.16), (0.07, 0.2),
                        (0.15, 0.26), (0.17, 0.42), (0.15, 0.42), (0.13, 0.28), (0.0, 0.24)], mat="gold", seg=28)
    handles = [torus("th", 0.07, 0.018, loc=(sx * 0.17, 0, 0.34), rot=("X", math.pi / 2), mat="gold", seg=16, ring=6, arc=1.0) for sx in (-1, 1)]
    join("prop_trophy", [cup] + handles, 40)


def build_pieces():
    reset()
    chess_set()
    dam_and_ludo()
    export(os.path.join(OUT, "kk_pieces.glb"))


def build_hero():
    reset()
    hero_body()
    hero_outfits()
    hero_hair()
    hero_hats()
    hero_props()
    export(os.path.join(OUT, "kk_hero.glb"))


if __name__ == "__main__":
    build_pieces()
    build_hero()
    names = sorted(o.name for o in bpy.data.objects)
    print("hero parts:", ", ".join(names))
