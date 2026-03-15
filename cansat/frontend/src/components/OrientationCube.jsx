/**
 * OrientationCube — Three.js canvas component
 * Maps MPU-6050 Madgwick quaternion to a 3D CanSat model.
 * No react-three-fiber needed — plain Three.js is lighter.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const FACE_COLORS = {
  top:    0x4ade80,   // green  — nose up
  bottom: 0xf472b6,   // pink   — tail
  front:  0x60a5fa,   // blue
  back:   0x94a3b8,   // gray
  left:   0xa78bfa,   // purple
  right:  0xfbbf24,   // amber
}

export default function OrientationCube({ quaternion }) {
  const mountRef = useRef(null)
  const stateRef = useRef({})

  useEffect(() => {
    const el = mountRef.current
    const W = el.clientWidth, H = el.clientHeight

    // Scene
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(W, H)
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, W/H, 0.1, 100)
    camera.position.set(0, 0.8, 3)
    camera.lookAt(0, 0, 0)

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(3, 5, 3)
    scene.add(dir)

    // CanSat body — cylinder (fuselage)
    const bodyGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.4, 32)
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0x1e2330, shininess: 40 })
    const body    = new THREE.Mesh(bodyGeo, bodyMat)

    // Nose cone
    const noseGeo = new THREE.ConeGeometry(0.35, 0.55, 32)
    const noseMat = new THREE.MeshPhongMaterial({ color: 0x4ade80, shininess: 60 })
    const nose    = new THREE.Mesh(noseGeo, noseMat)
    nose.position.y = 0.975

    // Fins (4×)
    const finGeo = new THREE.BoxGeometry(0.06, 0.45, 0.35)
    const finMat = new THREE.MeshPhongMaterial({ color: 0x60a5fa })
    const angles = [0, Math.PI/2, Math.PI, -Math.PI/2]
    const fins = angles.map(a => {
      const fin = new THREE.Mesh(finGeo, finMat)
      fin.position.y = -0.55
      fin.position.x = Math.sin(a) * 0.42
      fin.position.z = Math.cos(a) * 0.42
      return fin
    })

    // Axes indicator lines
    const axisX = new THREE.ArrowHelper(
      new THREE.Vector3(1,0,0), new THREE.Vector3(0,0,0), 0.8, 0xff6060, 0.15, 0.08)
    const axisY = new THREE.ArrowHelper(
      new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,0), 0.8, 0x60ff60, 0.15, 0.08)
    const axisZ = new THREE.ArrowHelper(
      new THREE.Vector3(0,0,1), new THREE.Vector3(0,0,0), 0.8, 0x6060ff, 0.15, 0.08)

    const group = new THREE.Group()
    group.add(body, nose, axisX, axisY, axisZ, ...fins)
    scene.add(group)

    stateRef.current = { renderer, scene, camera, group }

    // Animate
    let animId
    const animate = () => {
      animId = requestAnimationFrame(animate)
      renderer.render(scene, camera)
    }
    animate()

    // Resize
    const onResize = () => {
      const W2 = el.clientWidth, H2 = el.clientHeight
      renderer.setSize(W2, H2)
      camera.aspect = W2/H2
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  // Update rotation when quaternion prop changes
  useEffect(() => {
    const { group } = stateRef.current
    if (!group || !quaternion) return
    const [w, x, y, z] = quaternion
    group.quaternion.set(x, y, z, w)
  }, [quaternion])

  return (
    <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
  )
}
