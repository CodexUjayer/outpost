# Inspect a .blend file: scene units, hierarchy, dimensions, materials, textures,
# lights, cameras, animations. Run:
#   blender --background file.blend --python blend-inspect.py
import bpy, sys, json

def fmt(v):
    try:
        return [round(float(x), 4) for x in v]
    except TypeError:
        return v

print("=" * 70)
print("SCENE:", bpy.path.basename(bpy.data.filepath))
sc = bpy.context.scene
print("unit_system:", sc.unit_settings.system, "| scale_length:", sc.unit_settings.scale_length)
print("frame_range:", sc.frame_start, "->", sc.frame_end, "| fps:", sc.render.fps)
print("=" * 70)

print("\n--- OBJECTS (%d) ---" % len(bpy.data.objects))
for ob in bpy.data.objects:
    bb = [ob.matrix_world @ Vector_corner for Vector_corner in ()]  # placeholder
    dims = fmt(ob.dimensions)
    loc = fmt(ob.matrix_world.translation)
    rot = fmt(ob.rotation_euler) if ob.rotation_mode != 'QUATERNION' else fmt(ob.rotation_quaternion)
    scale = fmt(ob.matrix_world.to_scale())
    parent = ob.parent.name if ob.parent else None
    verts = ""
    if ob.type == 'MESH':
        verts = " verts=%d tris=%d" % (len(ob.data.vertices), len(ob.data.polygons))
    print(f"[{ob.type:9}] '{ob.name}' parent='{parent}' loc={loc} rot={rot} scale={scale} dims={dims}{verts}")

print("\n--- MESH WORLD BOUNDS ---")
from mathutils import Vector
for ob in bpy.data.objects:
    if ob.type != 'MESH':
        continue
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    print(f"'{ob.name}': min=({mn[0]:.3f},{mn[1]:.3f},{mn[2]:.3f}) max=({mx[0]:.3f},{mx[1]:.3f},{mx[2]:.3f})")

print("\n--- MATERIALS ---")
for mat in bpy.data.materials:
    users = [o.name for o in bpy.data.objects if o.type == 'MESH' and any(m.material == mat for m in o.material_slots)]
    imgs = []
    if mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                fp = n.image.filepath or (n.image.packed_file.filepath if n.image.packed_file else '')
                packed = bool(n.image.packed_file)
                imgs.append(f"{n.image.name} packed={packed} src='{fp}' size={tuple(n.image.size)}")
    bsdf = None
    if mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                bsdf = {
                    'base_color': [round(c, 3) for c in n.inputs['Base Color'].default_value],
                    'metallic': round(n.inputs['Metallic'].default_value, 3),
                    'roughness': round(n.inputs['Roughness'].default_value, 3),
                    'emission': [round(c, 3) for c in n.inputs['Emission Color'].default_value] if 'Emission Color' in n.inputs else None,
                    'emission_strength': round(n.inputs['Emission Strength'].default_value, 3) if 'Emission Strength' in n.inputs else 0,
                    'alpha': round(n.inputs['Alpha'].default_value, 3),
                }
    print(f"MAT '{mat.name}' users={users} blend={mat.blend_method}")
    if bsdf: print("   bsdf:", json.dumps(bsdf))
    for im in imgs: print("   img:", im)

print("\n--- LIGHTS ---")
for ob in bpy.data.objects:
    if ob.type == 'LIGHT':
        L = ob.data
        print(f"LIGHT '{ob.name}' type={L.type} energy={L.energy} color={fmt(L.color)} loc={fmt(ob.matrix_world.translation)}")

print("\n--- CAMERAS ---")
for ob in bpy.data.objects:
    if ob.type == 'CAMERA':
        print(f"CAMERA '{ob.name}' loc={fmt(ob.matrix_world.translation)}")

print("\n--- IMAGES (all) ---")
for im in bpy.data.images:
    print(f"IMAGE '{im.name}' packed={bool(im.packed_file)} src='{im.filepath}' size={tuple(im.size)}")

print("\n--- ANIMATIONS ---")
for ob in bpy.data.objects:
    if ob.animation_data and ob.animation_data.action:
        print(f"ACTION '{ob.animation_data.action.name}' on '{ob.name}'")

print("\n--- TEXTS ---")
for t in bpy.data.texts:
    print(f"TEXT '{t.name}'")
print("DONE")
