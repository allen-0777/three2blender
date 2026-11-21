"""以 Blender 無頭模式產生楓樹模型並匯出 GLB。

用法：
    blender --background --factory-startup --python blender/generate_trees.py -- public/models/maple_trees.glb

每個變體輸出兩個物件：Maple_<n>_Trunk（枝幹）與 Maple_<n>_Foliage（葉片）。
葉片顏色烘焙在頂點色（COLOR_0），three.js 端直接以 vertexColors 顯示。
已於 Blender 5.3.0 驗證。
"""

import math
import random
import sys

import bpy
from mathutils import Vector

UP = Vector((0.0, 0.0, 1.0))
MAX_DEPTH = 3
RING_SIDES = 7
LEAVES_PER_CLUSTER = 42

# 每個變體的（樹冠內側色, 樹冠外側色）；外側與頂部較紅，內側偏黃橘
VARIANTS = [
    ("#e8641c", "#b3161f"),
    ("#f59a1e", "#d92b1a"),
    ("#f7b52a", "#e5601a"),
    ("#f6c443", "#ee8a1d"),
    ("#c43a1a", "#8e1220"),
]

# 楓葉輪廓（葉柄朝 -Y），由中心點以扇形三角化
LEAF_OUTLINE = [
    (0.0, -0.5), (0.18, -0.28), (0.5, -0.1), (0.26, 0.02), (0.42, 0.3),
    (0.14, 0.18), (0.0, 0.52), (-0.14, 0.18), (-0.42, 0.3), (-0.26, 0.02),
    (-0.5, -0.1), (-0.18, -0.28),
]

ICOSAHEDRON_FACES = [
    (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
    (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
    (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
    (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
]


def icosahedron_vertices():
    t = (1.0 + math.sqrt(5.0)) / 2.0
    raw = [
        (-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0),
        (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
        (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1),
    ]
    return [Vector(v).normalized() for v in raw]


ICOSAHEDRON_VERTS = icosahedron_vertices()


def srgb_to_linear(hex_color):
    def channel(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    h = hex_color.lstrip("#")
    return Vector([channel(int(h[i : i + 2], 16)) for i in (0, 2, 4)])


def random_unit(rng):
    while True:
        v = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        if 0.05 < v.length <= 1.0:
            return v.normalized()


def any_perpendicular(direction):
    ref = Vector((1.0, 0.0, 0.0)) if abs(direction.z) > 0.9 else UP
    return direction.cross(ref).normalized()


# ---------------------------------------------------------------- 枝幹骨架


def grow(rng, start, direction, length, radius, depth, branches, anchors):
    """遞迴生長一段枝條；末端枝條把端點登記為葉叢錨點。"""
    segments = 4
    points = [start.copy()]
    radii = [radius]
    d = direction.normalized()
    for i in range(segments):
        lift = UP * (0.08 if depth > 0 else 0.0)
        d = (d + random_unit(rng) * 0.2 + lift).normalized()
        points.append(points[-1] + d * (length / segments))
        radii.append(radius * (1.0 - 0.4 * (i + 1) / segments))
    branches.append((points, radii))

    if depth == MAX_DEPTH:
        anchors.append(points[-1])
        anchors.append(points[segments // 2])
        return

    child_count = 3 if depth == 0 else rng.choice([2, 3])
    u = any_perpendicular(d)
    v = d.cross(u)
    base_azimuth = rng.uniform(0, math.tau)
    for j in range(child_count):
        spread = rng.uniform(0.55, 1.0)
        azimuth = base_azimuth + j * math.tau / child_count + rng.uniform(-0.4, 0.4)
        side = u * math.cos(azimuth) + v * math.sin(azimuth)
        child_dir = d * math.cos(spread) + side * math.sin(spread)
        child_dir.z = max(child_dir.z, 0.12)  # 不讓枝條往下長
        grow(
            rng,
            points[-1],
            child_dir,
            length * rng.uniform(0.62, 0.8),
            radii[-1] * 0.78,
            depth + 1,
            branches,
            anchors,
        )


def build_trunk_mesh(name, branches):
    verts, faces = [], []
    for points, radii in branches:
        base = len(verts)
        u = None
        for i, point in enumerate(points):
            prev_point = points[max(i - 1, 0)]
            next_point = points[min(i + 1, len(points) - 1)]
            tangent = (next_point - prev_point).normalized()
            # 平行輸運座標系，避免相鄰環之間扭轉
            if u is None:
                u = any_perpendicular(tangent)
            else:
                u = (u - tangent * u.dot(tangent)).normalized()
            v = tangent.cross(u)
            for s in range(RING_SIDES):
                angle = math.tau * s / RING_SIDES
                offset = u * math.cos(angle) + v * math.sin(angle)
                verts.append(point + offset * radii[i])
        for i in range(len(points) - 1):
            for s in range(RING_SIDES):
                a = base + i * RING_SIDES + s
                b = base + i * RING_SIDES + (s + 1) % RING_SIDES
                faces.append((a, b, b + RING_SIDES, a + RING_SIDES))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()
    return mesh


# ---------------------------------------------------------------- 葉片


def build_foliage_mesh(name, rng, anchors, inner_color, outer_color):
    verts, faces, colors = [], [], []

    crown_center = sum(anchors, Vector()) / len(anchors)
    crown_radius = max((a - crown_center).length for a in anchors) + 0.8
    z_min = min(a.z for a in anchors) - 0.6
    z_max = max(a.z for a in anchors) + 0.8

    def shade(position, jitter):
        """依離樹冠中心的距離與高度決定顏色：外側偏紅且亮，內側偏黃且暗。"""
        outward = min((position - crown_center).length / crown_radius, 1.0)
        height = (position.z - z_min) / (z_max - z_min)
        t = max(0.0, min(1.0, 0.55 * outward + 0.45 * height + jitter))
        color = inner_color.lerp(outer_color, t)
        brightness = 0.72 + 0.28 * outward
        return color * brightness

    for anchor in anchors:
        center = anchor + UP * 0.1
        radius = rng.uniform(0.55, 0.85)

        # 深色實心團塊，擋住葉片之間的空隙
        base = len(verts)
        fill_color = outer_color * 0.55
        for iv in ICOSAHEDRON_VERTS:
            verts.append(center + Vector((iv.x, iv.y, iv.z * 0.8)) * radius * 0.42)
            colors.append(fill_color)
        faces.extend((base + a, base + b, base + c) for a, b, c in ICOSAHEDRON_FACES)

        for _ in range(LEAVES_PER_CLUSTER):
            direction = random_unit(rng)
            if direction.z < -0.3:
                direction.z *= -0.5
                direction.normalize()
            offset = direction * radius * rng.uniform(0.7, 1.05)
            offset.z *= 0.8
            position = center + offset

            normal = (direction + random_unit(rng) * 0.5).normalized()
            # 葉尖大致朝下垂
            hang = Vector((0, 0, -1)) + random_unit(rng) * 0.6
            tip = hang - normal * hang.dot(normal)
            if tip.length < 1e-4:
                tip = any_perpendicular(normal)
            tip.normalize()
            right = tip.cross(normal)

            size = rng.uniform(0.24, 0.38)
            color = shade(position, rng.uniform(-0.2, 0.2)) * rng.uniform(0.85, 1.1)
            color = Vector([min(c, 1.0) for c in color])

            base = len(verts)
            # 中心點略為內凹，讓葉片有對折的立體感
            verts.append(position - normal * size * 0.12 - tip * size * 0.05)
            colors.append(color * 0.85)
            for x, y in LEAF_OUTLINE:
                verts.append(position + (right * x + tip * y) * size)
                colors.append(color)
            count = len(LEAF_OUTLINE)
            for i in range(count):
                faces.append((base, base + 1 + i, base + 1 + (i + 1) % count))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))

    attribute = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="POINT")
    flat = []
    for color in colors:
        flat.extend((color.x, color.y, color.z, 1.0))
    attribute.data.foreach_set("color", flat)
    mesh.color_attributes.active_color = attribute
    mesh.update()
    return mesh


# ---------------------------------------------------------------- 材質與匯出


def principled_node(material):
    for node in material.node_tree.nodes:
        if node.bl_idname == "ShaderNodeBsdfPrincipled":
            return node
    raise RuntimeError("找不到 Principled BSDF 節點")


def create_materials():
    bark = bpy.data.materials.new("Bark")
    node = principled_node(bark)
    node.inputs["Base Color"].default_value = (*srgb_to_linear("#3a2317"), 1.0)
    node.inputs["Roughness"].default_value = 1.0

    foliage = bpy.data.materials.new("Foliage")
    foliage.use_backface_culling = False  # 匯出為 doubleSided
    node = principled_node(foliage)
    node.inputs["Roughness"].default_value = 0.85
    color_node = foliage.node_tree.nodes.new("ShaderNodeVertexColor")
    color_node.layer_name = "Color"
    foliage.node_tree.links.new(color_node.outputs["Color"], node.inputs["Base Color"])
    return bark, foliage


def add_object(name, mesh, material):
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_tree(index, inner_hex, outer_hex, bark, foliage):
    rng = random.Random(1000 + index)
    branches, anchors = [], []
    lean = Vector((rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 1.0))
    grow(rng, Vector((0, 0, 0)), lean, rng.uniform(1.5, 1.9), 0.17, 0, branches, anchors)
    branches[0][1][0] *= 1.6  # 樹根處加粗

    add_object(f"Maple_{index}_Trunk", build_trunk_mesh(f"Maple_{index}_Trunk", branches), bark)
    foliage_mesh = build_foliage_mesh(
        f"Maple_{index}_Foliage",
        rng,
        anchors,
        srgb_to_linear(inner_hex),
        srgb_to_linear(outer_hex),
    )
    add_object(f"Maple_{index}_Foliage", foliage_mesh, foliage)
    height = max(a.z for a in anchors) + 0.8
    print(
        f"[maple] 變體 {index}: 葉叢 {len(anchors)}、"
        f"三角面 {len(foliage_mesh.polygons)}、高度約 {height:.2f} m"
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 1:
        raise SystemExit("用法：blender --background --python generate_trees.py -- <輸出.glb>")
    output_path = bpy.path.abspath(argv[0])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bark, foliage = create_materials()
    for index, (inner_hex, outer_hex) in enumerate(VARIANTS):
        build_tree(index, inner_hex, outer_hex, bark, foliage)

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_texcoords=False,
        export_normals=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_yup=True,
    )
    print(f"[maple] 已匯出 {output_path}")


if __name__ == "__main__":
    main()
