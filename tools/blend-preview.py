# Render preview views of the ship interior to understand the layout.
import bpy, math, sys
from mathutils import Vector

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 24
sc.cycles.use_denoising = False
sc.render.resolution_x = 720
sc.render.resolution_y = 480
sc.render.film_transparent = False
# device CPU
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'NONE'
prefs.get_devices()

# compute scene bounds
mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
for ob in bpy.data.objects:
    if ob.type != 'MESH':
        continue
    for c in ob.bound_box:
        w = ob.matrix_world @ Vector(c)
        mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
center = (mn + mx) / 2
size = (mx - mn)
print("BOUNDS", [round(v,2) for v in mn], [round(v,2) for v in mx], "size", [round(v,2) for v in size])

cam_data = bpy.data.cameras.new("Prev")
cam = bpy.data.objects.new("PrevCam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam

def shot(name, target, dist, elev_deg, azim_deg, lens=24):
    cam_data.lens = lens
    a = math.radians(azim_deg); e = math.radians(elev_deg)
    d = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e))) * dist
    cam.location = target + d
    direction = Vector(target) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f"/tmp/shipview_{name}.png"
    bpy.ops.render.render(write_still=True)
    print("rendered", name)

cx, cy, cz = center.x, center.y, center.z
half = max(size.x, size.y) / 2
shot("top", (cx, cy, cz), half * 2.6, 88, 0, lens=35)
shot("iso_a", (cx, cy, cz), half * 2.2, 42, 35)
shot("iso_b", (cx, cy, cz), half * 2.2, 18, 215)
shot("iso_c", (cx, cy, cz), half * 2.2, 10, 130)
print("PREVIEWS_DONE")
