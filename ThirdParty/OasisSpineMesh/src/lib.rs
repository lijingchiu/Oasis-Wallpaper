use std::{cell::RefCell, sync::Arc};

use chine::{
    anim::AnimationState, atlas::Atlas, data::BlendMode, load,
    render::{bind_atlas, render_with, RenderScratch}, skel::Skeleton,
};

// The importer and the isolated Web wallpaper use exactly the same pose decoder.
// All input and output buffers belong to the module; JS only supplies lengths.
struct Rig {
    skeleton: Skeleton,
    animation: AnimationState,
    scratch: RenderScratch,
    vertices: Vec<f32>,
    batches: Vec<[u32; 4]>,
}
thread_local! {
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static RIG: RefCell<Option<Rig>> = const { RefCell::new(None) };
}

#[no_mangle]
pub extern "C" fn input(size: usize) -> *mut u8 {
    if size == 0 || size > 24 * 1024 * 1024 { return std::ptr::null_mut(); }
    INPUT.with_borrow_mut(|bytes| { bytes.resize(size, 0); bytes.as_mut_ptr() })
}

#[no_mangle]
pub extern "C" fn open_rig(json_size: usize) -> bool {
    let rig = INPUT.with_borrow(|bytes| {
        if json_size >= bytes.len() { return None; }
        let atlas = Atlas::parse(std::str::from_utf8(&bytes[json_size..]).ok()?);
        if atlas.pages.is_empty() || atlas.pages.len() > 32 { return None; }
        let mut data = load::from_json(std::str::from_utf8(&bytes[..json_size]).ok()?).ok()?;
        if data.bones.is_empty() || data.bones.len() > 4096 || data.animations.is_empty() { return None; }
        bind_atlas(&mut data, &atlas);
        let mut skeleton = Skeleton::new(Arc::new(data));
        skeleton.set_skin("oasis-selected");
        skeleton.set_slots_to_setup_pose();
        Some(Rig { skeleton, animation: AnimationState::new(), scratch: RenderScratch::default(),
                   vertices: Vec::new(), batches: Vec::new() })
    });
    let ok = rig.is_some();
    RIG.with_borrow_mut(|slot| *slot = rig);
    ok
}

#[no_mangle]
pub extern "C" fn play(looping: bool) -> f32 {
    RIG.with_borrow_mut(|slot| INPUT.with_borrow(|bytes| {
        let Some(rig) = slot.as_mut() else { return 0.0; };
        let Ok(name) = std::str::from_utf8(bytes) else { return 0.0; };
        let Some(anim) = rig.skeleton.data().find_animation(name).cloned() else { return 0.0; };
        let duration = anim.duration();
        rig.animation.set_animation(anim, looping);
        duration
    }))
}

#[no_mangle]
pub extern "C" fn pose(seconds: f32) -> usize {
    RIG.with_borrow_mut(|slot| {
        let Some(rig) = slot.as_mut() else { return 0; };
        rig.vertices.clear();
        rig.batches.clear();
        let dt = seconds.clamp(0.0, 0.25);
        rig.animation.update(dt);
        rig.skeleton.update(dt);
        rig.skeleton.set_bones_to_setup_pose();
        rig.animation.apply(&mut rig.skeleton);
        rig.skeleton.update_world_transform();
        for draw in render_with(&rig.skeleton, &mut rig.scratch) {
            if draw.triangles.is_empty() || draw.color.a <= 0.0 { continue; }
            let blend = match draw.blend { BlendMode::Normal => 0, BlendMode::Additive => 1,
                                           BlendMode::Multiply => 2, BlendMode::Screen => 3 };
            let page = draw.page as u32;
            let count = draw.triangles.len() as u32;
            let first = (rig.vertices.len() / 8) as u32;
            if first + count > 1_000_000 { return 0; }
            if let Some(last) = rig.batches.last_mut().filter(|b| b[0] == page && b[1] == blend) {
                last[3] += count;
            } else { rig.batches.push([page, blend, first, count]); }
            for &index in &draw.triangles {
                let i = usize::from(index);
                let Some(p) = draw.positions.get(i) else { return 0; };
                let Some(uv) = draw.uvs.get(i*2..i*2+2) else { return 0; };
                let c = draw.color;
                rig.vertices.extend_from_slice(&[p.x, p.y, uv[0], uv[1], c.r, c.g, c.b, c.a]);
            }
        }
        rig.vertices.len()
    })
}

#[no_mangle]
pub extern "C" fn vertices() -> *const f32 {
    RIG.with_borrow(|slot| slot.as_ref().map_or(std::ptr::null(), |r| r.vertices.as_ptr()))
}
#[no_mangle]
pub extern "C" fn batches() -> *const u32 {
    RIG.with_borrow(|slot| slot.as_ref().map_or(std::ptr::null(), |r| r.batches.as_ptr().cast()))
}
#[no_mangle]
pub extern "C" fn batch_count() -> usize {
    RIG.with_borrow(|slot| slot.as_ref().map_or(0, |r| r.batches.len()))
}
