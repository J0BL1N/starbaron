// Showcase generator as a vitest test. Writes docs/showcase-planets-3d.html.
// Run: npx vitest run tests/showcase-planets-3d.test.ts
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PLANETS } from '../src/sim/data/planets'
import {
  generatePlanetIdentity,
  radiusBandOf,
  resolveRadius,
} from '../src/sim/planets'
import { buildHostStars } from '../src/ui/planetgen3d/hosts'
import { scaleGalaxyPositions } from '../src/ui/planetgen3d/galaxy'

const SHOWCASE_NAMES = [
  'K2-210 b',
  'Kepler-452 b',
  'K2-156 b',
  'Kepler-200 c',
  'HD 158259 e',
  'Kepler-22 b',
  'HD 205158 b',
  'Kepler-304 d',
  'HAT-P-64 b',
  'Kepler-82 c',
]

// Star-first galaxy: group by host, sample ~500 host stars for the mirror.
const ALL_HOSTS = buildHostStars(PLANETS)
const HOST_SAMPLE_COUNT = 500
const HOST_STEP = Math.floor(ALL_HOSTS.length / HOST_SAMPLE_COUNT)
const HOST_SAMPLES = ALL_HOSTS.filter((_, i) => i % HOST_STEP === 0).slice(
  0,
  HOST_SAMPLE_COUNT,
)
const HOST_SCALED = scaleGalaxyPositions(
  HOST_SAMPLES.map((host) => host.representativePosition),
)

const DEMO_HOST = ALL_HOSTS.find((h) => h.hostname === 'Kepler-452') ?? ALL_HOSTS[0]!

/**
 * Inline documented browser mirror of src/ui/planetgen3d/*.
 * Uses CDN three via importmap so the file works from file:// or a local server.
 */
const RENDER_JS = `// === StarBaron 3D renderer mirror (from src/ui/planetgen3d/*) ===
function fnv1a(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)}return h>>>0}
function mulberry32(a){return function(){a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}
function rngFrom(s){return mulberry32(fnv1a(s))}

class NoiseField{
  constructor(seed,octaves=5,base=64){
    this.octaves=[]
    for(let o=0;o<octaves;o++){
      const n=Math.max(2,base>>o),r=rngFrom(seed+':n'+o)
      const g=new Float32Array((n+1)*(n+1))
      for(let i=0;i<g.length;i++)g[i]=r()
      this.octaves.push({n,g})
    }
  }
  sample(x,y){
    let sum=0,amp=1,total=0
    for(const {n,g} of this.octaves){
      const X=x*n,Y=y*n,x0=Math.floor(X)%n,y0=Math.floor(Y)%n
      const fx=X-Math.floor(X),fy=Y-Math.floor(Y)
      const i=y0*(n+1)+x0
      const v00=g[i],v10=g[i+1],v01=g[i+n+1],v11=g[i+n+2]
      const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy)
      sum+=((v00*(1-sx)+v10*sx)*(1-sy)+(v01*(1-sx)+v11*sx)*sy)*amp
      total+=amp;amp*=0.5
    }
    return sum/total
  }
}
const lerp=(a,b,t)=>a+(b-a)*t
function mixRGB(a,b,t){return[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)]}
function ramp(stops,t){
  if(t<=stops[0][0])return stops[0][1]
  for(let i=1;i<stops.length;i++){if(t<=stops[i][0]){const[a,c1]=stops[i-1],[b,c2]=stops[i];return mixRGB(c1,c2,(t-a)/(b-a))}}
  return stops[stops.length-1][1]
}
function hex(h){h=h.replace('#','');return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]}
function canvasFromRGB(size,fn){
  const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d')
  const img=g.createImageData(size,size)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const [r,gg,b,a]=fn(x/size,y/size);const i=(y*size+x)*4
    img.data[i]=r;img.data[i+1]=gg;img.data[i+2]=b;img.data[i+3]=a
  }
  g.putImageData(img,0,0);return c
}

function earthTex(name,size,palette){
  const nf=new NoiseField(name,6,96)
  const deep=hex('#0a2e5c'),mid=hex('#14508c'),shallow=hex(palette[1]),sand=hex('#c8b080')
  const grass=hex(palette[2]),forest=hex(palette[3]),rock=hex('#8a7a5a'),snow=hex('#f0f0f8')
  return canvasFromRGB(size,(x,y)=>{
    const lat=Math.abs(y-0.5)*2
    let e=nf.sample(x*1.3,y*1.3)
    e=(e-0.5)*1.7+0.5
    e+=Math.sin(x*Math.PI*2)*0.05+Math.cos(y*Math.PI*2)*0.05
    const polar=Math.max(0,(lat-0.78)/0.22)
    let col
    if(e<0.46)col=ramp([[0,deep],[0.35,mid],[0.46,shallow]],e)
    else if(e<0.5)col=ramp([[0.46,shallow],[0.5,sand]],e)
    else if(e<0.72)col=ramp([[0.5,sand],[0.58,grass],[0.72,forest]],e)
    else col=ramp([[0.72,forest],[0.85,rock],[1,snow]],e)
    col=mixRGB(col,snow,polar)
    return[...col,255]
  })
}
function gasTex(name,size,palette){
  const nf=new NoiseField(name,5,64)
  const c1=hex(palette[1]),c2=hex(palette[2]),c3=hex(palette[3]),c4=hex(palette[0])
  return canvasFromRGB(size,(x,y)=>{
    const turb=nf.sample(x*3,y*6)*1.6+nf.sample(x*9,y*14)*0.5
    const band=Math.sin(y*Math.PI*14+turb*2.2)*0.5+0.5
    let col=ramp([[0,c3],[0.35,c1],[0.55,c2],[0.75,c3],[1,c4]],band)
    const swirl=nf.sample(x*5,y*3)
    col=mixRGB(col,c2,swirl*0.18)
    return[...col,255]
  })
}
function rockyTex(name,size,palette){
  const nf=new NoiseField(name,6,80)
  const base=hex(palette[1]),dark=hex(palette[3]),light=hex(palette[2])
  const r=rngFrom(name+':cr')
  const craters=[];for(let i=0;i<26;i++)craters.push({x:r(),y:r(),rad:0.02+r()*0.07,deep:r()})
  return canvasFromRGB(size,(x,y)=>{
    let e=nf.sample(x*2,y*2)*0.6+nf.sample(x*6,y*6)*0.4
    let col=ramp([[0,dark],[0.5,base],[1,light]],e)
    for(const cr of craters){
      const dx=x-cr.x,dy=y-cr.y,d=Math.sqrt(dx*dx+dy*dy)/cr.rad
      if(d<1){
        const rim=1-Math.abs(d-0.78)/0.22
        col=mixRGB(col,light,Math.max(0,rim)*0.7*cr.deep)
        col=mixRGB(col,dark,Math.max(0,1-d)*0.6)
      }
    }
    return[...col,255]
  })
}
function chooseTexture(name,band,palette){
  if(band==='rocky')return rockyTex(name,512,palette)
  if(band==='gaseous')return gasTex(name,512,palette)
  return earthTex(name,512,palette)
}

const SPECTRAL={
  O:{color:'#9db4ff',glow:'#a8c8ff',size:15,glowInt:2.5},
  B:{color:'#aabfff',glow:'#b8d0ff',size:8,glowInt:2.0},
  A:{color:'#cad8ff',glow:'#dbe8ff',size:2.5,glowInt:1.6},
  F:{color:'#f8f7ff',glow:'#fff4d8',size:1.4,glowInt:1.3},
  G:{color:'#fff4e8',glow:'#ffdca0',size:1,glowInt:1.0},
  K:{color:'#ffddb4',glow:'#ffc078',size:0.8,glowInt:0.8},
  M:{color:'#ffbd81',glow:'#ff9a60',size:0.5,glowInt:0.6},
  unknown:{color:'#e8e8e8',glow:'#d0d0d0',size:1,glowInt:0.9}
}
function spectralClass(st){if(!st)return'unknown';const l=st.trim().charAt(0).toUpperCase();return SPECTRAL[l]?l:'unknown'}

function keplerPosition(a,e,inc,node,argP,period,t){
  const M=((t/period)%1)*Math.PI*2;let E=M
  for(let i=0;i<8;i++){E=E-(E-e*Math.sin(E)-M)/(1-e*Math.cos(E))}
  const x=a*(Math.cos(E)-e),z=a*Math.sqrt(1-e*e)*Math.sin(E)
  const cw=Math.cos(argP),sw=Math.sin(argP)
  const x1=x*cw-z*sw,z1=x*sw+z*cw
  const ci=Math.cos(inc),si=Math.sin(inc)
  const y1=z1*si,z2=z1*ci
  const cn=Math.cos(node),sn=Math.sin(node)
  return new THREE.Vector3(x1*cn+z2*sn,y1,-x1*sn+z2*cn)
}
function elements(seed,a){
  const r=rngFrom(seed)
  return {a,e:0.01+r()*0.09,inc:(r()-0.5)*0.05,node:r()*Math.PI*2,argP:r()*Math.PI*2,period:Math.pow(a,1.5)*30,phase:r()*Math.PI*2,spin:0.05+r()*0.4,tilt:(r()-0.5)*0.5}
}

function glowTexture(){
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d')
  const gr=g.createRadialGradient(128,128,0,128,128,128)
  gr.addColorStop(0,'rgba(255,236,180,0.9)')
  gr.addColorStop(0.25,'rgba(255,214,120,0.35)')
  gr.addColorStop(1,'rgba(255,200,100,0)')
  g.fillStyle=gr;g.fillRect(0,0,256,256)
  return new THREE.CanvasTexture(c)
}

function circleSprite(){
  const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d')
  const gr=g.createRadialGradient(32,32,0,32,32,32)
  gr.addColorStop(0,'rgba(255,255,255,1)')
  gr.addColorStop(0.55,'rgba(255,255,255,1)')
  gr.addColorStop(0.85,'rgba(255,255,255,0.35)')
  gr.addColorStop(1,'rgba(255,255,255,0)')
  g.fillStyle=gr;g.fillRect(0,0,64,64)
  return new THREE.CanvasTexture(c)
}

function buildCard(container,planet){
  const scene=new THREE.Scene()
  const camera=new THREE.PerspectiveCamera(55,1,0.01,1000)
  camera.position.set(0,0,3.4)
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true})
  renderer.setPixelRatio(Math.min(devicePixelRatio,2))
  renderer.setSize(220,220)
  container.appendChild(renderer.domElement)

  scene.add(new THREE.AmbientLight(0x223344,0.4))
  const sun=new THREE.DirectionalLight(0xfff2d8,2.4);sun.position.set(5,3,4);scene.add(sun)
  const fill=new THREE.DirectionalLight(0x4466aa,0.35);fill.position.set(-4,-2,-3);scene.add(fill)

  const spec=SPECTRAL[spectralClass(planet.starType)]
  const starSize=2.6*spec.size
  const starMesh=new THREE.Mesh(new THREE.SphereGeometry(starSize,32,32),new THREE.MeshBasicMaterial({color:spec.color}))
  starMesh.position.set(8,4,6);scene.add(starMesh)
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture(),color:spec.glow,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true}))
  glow.scale.set(starSize*10,starSize*10,1);glow.position.copy(starMesh.position);scene.add(glow)

  const radius=planet.tier*0.18
  const tex=chooseTexture(planet.name,planet.radiusBand,planet.palette)
  const mat=new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(tex),roughness:0.92,metalness:0})
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,48,48),mat)
  const holder=new THREE.Group();holder.add(mesh);scene.add(holder)

  if(planet.atmosphereTint){
    holder.add(new THREE.Mesh(new THREE.SphereGeometry(radius*1.14,48,48),
      new THREE.MeshBasicMaterial({color:planet.atmosphereTint,transparent:true,opacity:0.25,side:THREE.BackSide})))
  }
  if(planet.clouds){
    const ctex=chooseTexture(planet.name+':cl','earthlike',['#e8f0f8','#ffffff','#d0d8e0'])
    holder.add(new THREE.Mesh(new THREE.SphereGeometry(radius*1.025,48,48),
      new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(ctex),transparent:true,opacity:0.95,depthWrite:false,roughness:1})))
  }
  if(planet.ringed){
    const r1=new THREE.Mesh(new THREE.RingGeometry(radius*1.6,radius*2.5,64),
      new THREE.MeshBasicMaterial({color:0xd8c8a0,side:THREE.DoubleSide,transparent:true,opacity:0.65}))
    r1.rotation.x=Math.PI/2+0.28;r1.rotation.z=0.15;holder.add(r1)
    const r2=new THREE.Mesh(new THREE.RingGeometry(radius*2.6,radius*2.9,64),
      new THREE.MeshBasicMaterial({color:0x8a7a5a,side:THREE.DoubleSide,transparent:true,opacity:0.3}))
    r2.rotation.x=Math.PI/2+0.28;r2.rotation.z=0.15;holder.add(r2)
  }

  const moons=[]
  for(let k=0;k<planet.moons;k++){
    const me=elements(planet.name+'|moon|'+k,radius*2.2+k*0.5)
    me.period*=0.05
    const mm=new THREE.Mesh(new THREE.SphereGeometry(radius*0.09,12,12),new THREE.MeshStandardMaterial({color:0x9aa0b0,roughness:1}))
    scene.add(mm);moons.push({m:mm,el:me})
  }

  const clock=new THREE.Clock()
  function animate(){
    requestAnimationFrame(animate)
    const dt=Math.min(clock.getDelta(),0.05)
    mesh.rotation.y+=dt*0.2
    const t=clock.elapsedTime*2
    for(const mo of moons){
      const p=keplerPosition(mo.el.a,mo.el.e,mo.el.inc,mo.el.node,mo.el.argP,mo.el.period,t+mo.el.phase)
      mo.m.position.copy(p)
    }
    renderer.render(scene,camera)
  }
  animate()
}

// === Host star grouping mirror (from src/ui/planetgen3d/hosts.ts) ===
function buildHostStars(planets){
  const map=new Map()
  for(const entry of planets){
    let host=map.get(entry.hostname)
    if(!host){
      host={hostname:entry.hostname,starType:entry.starType,entries:[],planetCount:0,bestTier:1}
      map.set(entry.hostname,host)
    }
    host.entries.push(entry)
    host.planetCount++
    if(entry.starType!==undefined&&host.starType===undefined)host.starType=entry.starType
    if(entry.tier>host.bestTier)host.bestTier=entry.tier
  }
  return Array.from(map.values())
}

const TIER_COLORS=['#4a4a52','#6a6a78','#8a8a9a','#b8a060','#ffa040']
const TIER_SIZES=[0.9,1.05,1.2,1.35,1.55]

// === Galaxy view: host stars, click a dot to approach its system ===
function buildGalaxyView(container,galaxyData,onSelectHost){
  const scene=new THREE.Scene()
  const camera=new THREE.PerspectiveCamera(55,container.clientWidth/Math.max(1,container.clientHeight),0.1,20000)
  camera.position.set(0,650,950)
  camera.lookAt(0,0,0)

  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true})
  renderer.setPixelRatio(Math.min(devicePixelRatio,2))
  renderer.setSize(container.clientWidth,container.clientHeight)
  container.innerHTML=''
  container.appendChild(renderer.domElement)

  const root=new THREE.Group()
  scene.add(root)

  // Sol
  const sol=new THREE.Mesh(
    new THREE.SphereGeometry(4,16,16),
    new THREE.MeshBasicMaterial({color:0xfff4c8})
  )
  root.add(sol)

  // Backdrop spiral
  const r=rngFrom('pg3d-v1|galaxy-backdrop|showcase')
  const backdropCount=2600
  const bdPos=new Float32Array(backdropCount*3)
  const bdCol=new Float32Array(backdropCount*3)
  const col=new THREE.Color()
  for(let i=0;i<backdropCount;i++){
    const arm=r()*Math.PI*2
    const radius=Math.pow(r(),0.7)*600
    const twist=arm+radius*0.004
    bdPos[i*3]=Math.cos(twist)*radius
    bdPos[i*3+1]=(r()-0.5)*8
    bdPos[i*3+2]=Math.sin(twist)*radius
    col.setHSL(0.05+r()*0.15,0.3+r()*0.3,0.2+r()*0.25)
    bdCol[i*3]=col.r;bdCol[i*3+1]=col.g;bdCol[i*3+2]=col.b
  }
  const bdGeo=new THREE.BufferGeometry()
  bdGeo.setAttribute('position',new THREE.BufferAttribute(bdPos,3))
  bdGeo.setAttribute('color',new THREE.BufferAttribute(bdCol,3))
  const backdrop=new THREE.Points(bdGeo,new THREE.PointsMaterial({size:1.2,vertexColors:true,transparent:true,opacity:0.28,sizeAttenuation:true}))
  root.add(backdrop)

  // Host star field (round sprites).
  const count=galaxyData.length
  const pos=new Float32Array(count*3)
  const colors=new Float32Array(count*3)
  for(let i=0;i<count;i++){
    const p=galaxyData[i]
    pos[i*3]=p.x;pos[i*3+1]=p.y;pos[i*3+2]=p.z
    const tier=Math.max(1,Math.min(5,p.bestTier))-1
    col.set(TIER_COLORS[tier])
    colors[i*3]=col.r;colors[i*3+1]=col.g;colors[i*3+2]=col.b
  }
  const fieldGeo=new THREE.BufferGeometry()
  fieldGeo.setAttribute('position',new THREE.BufferAttribute(pos,3))
  fieldGeo.setAttribute('color',new THREE.BufferAttribute(colors,3))
  const field=new THREE.Points(fieldGeo,new THREE.PointsMaterial({
    size:2.4,vertexColors:true,map:circleSprite(),transparent:true,opacity:0.92,
    sizeAttenuation:true,alphaTest:0.15,depthWrite:false
  }))
  root.add(field)

  // Click-to-approach a host
  const raycaster=new THREE.Raycaster()
  const pointer=new THREE.Vector2()
  renderer.domElement.addEventListener('click',(e)=>{
    const rect=renderer.domElement.getBoundingClientRect()
    pointer.x=((e.clientX-rect.left)/rect.width)*2-1
    pointer.y=-((e.clientY-rect.top)/rect.height)*2+1
    raycaster.setFromCamera(pointer,camera)
    raycaster.params.Points.threshold=8
    const hits=raycaster.intersectObject(field)
    if(hits.length>0&&hits[0].index!==undefined){
      onSelectHost(galaxyData[hits[0].index])
    }
  })

  const clock=new THREE.Clock()
  function animate(){
    requestAnimationFrame(animate)
    const dt=Math.min(clock.getDelta(),0.05)
    backdrop.rotation.y+=dt*0.008
    renderer.render(scene,camera)
  }
  animate()
}

// === System view: seeded solar system for a host, click a planet for close-up ===
function buildSystemView(container,host,onSelectPlanet){
  const scene=new THREE.Scene()
  const camera=new THREE.PerspectiveCamera(55,container.clientWidth/Math.max(1,container.clientHeight),0.01,30000)
  camera.position.set(0,40,90)

  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true})
  renderer.setPixelRatio(Math.min(devicePixelRatio,2))
  renderer.setSize(container.clientWidth,container.clientHeight)
  container.innerHTML=''
  container.appendChild(renderer.domElement)

  scene.add(new THREE.AmbientLight(0x223344,0.4))
  const sunLight=new THREE.DirectionalLight(0xfff2d8,2.4);sunLight.position.set(5,3,4);scene.add(sunLight)

  // Star
  const spec=SPECTRAL[spectralClass(host.starType)]
  const baseSize=2.6*spec.size
  const starMesh=new THREE.Mesh(new THREE.SphereGeometry(baseSize,32,32),new THREE.MeshBasicMaterial({color:spec.color}))
  scene.add(starMesh)
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture(),color:spec.glow,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true}))
  glow.scale.set(baseSize*10,baseSize*10,1);scene.add(glow)

  // Seeded planets
  const rng=rngFrom('pg3d-v1|sys|'+host.hostname)
  const planetCount=6+Math.floor(rng()*5)
  const homeIndex=Math.floor(rng()*planetCount)
  const baseDist=[5.5,7.5,9.5,12,17.5,24,31,38,48,58].slice(0,planetCount)
  const planets=[]
  const palette=host.entries[0]&&host.entries[0].palette?host.entries[0].palette:['#2f6fb0','#3a8a4a','#c8d8a0','#2a5c3a']
  for(let i=0;i<planetCount;i++){
    const isHome=i===homeIndex
    const name=isHome?host.entries[0].name:(host.hostname+' '+['b','c','d','e','f','g','h','i','j','k'][i-1])
    const tier=isHome?host.entries[0].tier:Math.floor(rng()*5)+1
    const radius=tier*0.22
    const a=baseDist[i]*(0.9+rng()*0.2)
    const el=elements('pg3d-v1|orb|'+name+'|'+host.hostname,a)
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,32,32),
      new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(chooseTexture(name,'earthlike',palette)),roughness:0.92,metalness:0}))
    mesh.userData={planet:{name,tier,band:'earthlike',profile:{surfacePalette:palette,atmosphereTint:null,ringed:false,moons:0,emoji:'🪐'}}}
    scene.add(mesh)
    planets.push({mesh,el,radius,name})

    // Orbit track
    const pts=[]
    for(let k=0;k<=160;k++){
      const p=keplerPosition(el.a,el.e,el.inc,el.node,el.argP,el.period,(k/160)*el.period)
      pts.push(p)
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0x2a3152,transparent:true,opacity:0.4})))
  }

  // Click planet
  const raycaster=new THREE.Raycaster()
  const pointer=new THREE.Vector2()
  renderer.domElement.addEventListener('click',(e)=>{
    const rect=renderer.domElement.getBoundingClientRect()
    pointer.x=((e.clientX-rect.left)/rect.width)*2-1
    pointer.y=-((e.clientY-rect.top)/rect.height)*2+1
    raycaster.setFromCamera(pointer,camera)
    const hits=raycaster.intersectObjects(planets.map(p=>p.mesh))
    if(hits.length>0){
      onSelectPlanet(hits[0].object.userData.planet)
    }
  })

  const clock=new THREE.Clock()
  let simTime=0
  function animate(){
    requestAnimationFrame(animate)
    const dt=Math.min(clock.getDelta(),0.05)
    simTime+=dt*2
    for(const p of planets){
      const pos=keplerPosition(p.el.a,p.el.e,p.el.inc,p.el.node,p.el.argP,p.el.period,simTime+p.el.phase)
      p.mesh.position.copy(pos)
      p.mesh.rotation.y+=dt*p.el.spin
    }
    const pulse=1+Math.sin(clock.elapsedTime*1.2)*0.03
    glow.scale.set(baseSize*10*pulse,baseSize*10*pulse,1)
    renderer.render(scene,camera)
  }
  animate()
}

// === Planet close-up view ===
function buildPlanetView(container,planet){
  const scene=new THREE.Scene()
  const camera=new THREE.PerspectiveCamera(55,container.clientWidth/Math.max(1,container.clientHeight),0.01,1000)
  camera.position.set(0,0,3.4)

  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true})
  renderer.setPixelRatio(Math.min(devicePixelRatio,2))
  renderer.setSize(container.clientWidth,container.clientHeight)
  container.innerHTML=''
  container.appendChild(renderer.domElement)

  scene.add(new THREE.AmbientLight(0x223344,0.4))
  const sun=new THREE.DirectionalLight(0xfff2d8,2.4);sun.position.set(5,3,4);scene.add(sun)

  const radius=planet.tier*0.18
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,48,48),
    new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(chooseTexture(planet.name,planet.radiusBand,planet.palette)),roughness:0.92,metalness:0}))
  scene.add(mesh)

  const clock=new THREE.Clock()
  function animate(){
    requestAnimationFrame(animate)
    const dt=Math.min(clock.getDelta(),0.05)
    mesh.rotation.y+=dt*0.2
    renderer.render(scene,camera)
  }
  animate()
}

// === Showcase wiring ===
function initJourney(container,galaxyData,demoHost){
  let current='galaxy'
  function showGalaxy(){
    current='galaxy'
    buildGalaxyView(container,galaxyData,(host)=>showSystem(host))
  }
  function showSystem(host){
    current='system'
    buildSystemView(container,host,(planet)=>showPlanet(planet))
  }
  function showPlanet(planet){
    current='planet'
    buildPlanetView(container,planet)
  }
  window.showcaseBack=()=>{
    if(current==='planet') showSystem(demoHost)
    else if(current==='system') showGalaxy()
  }
  showGalaxy()
}`

describe('showcase-planets-3d', () => {
  it('generates docs/showcase-planets-3d.html with star-first flow', () => {
    const samples = SHOWCASE_NAMES.map((name) => {
      const entry = PLANETS.find((p) => p.name === name)!
      const identity = generatePlanetIdentity(entry)
      const band = radiusBandOf(resolveRadius(entry, () => 0.5))
      return {
        name,
        tier: entry.tier,
        starType: entry.starType,
        radiusBand: band,
        palette: identity.visual.surfacePalette,
        atmosphereTint: identity.visual.atmosphereTint,
        ringed: identity.visual.ringed,
        moons: identity.visual.moons,
        emoji: identity.visual.emoji,
        distancePc: entry.distancePc,
        radiusEarth: entry.radiusEarth,
      }
    })

    const hostSamples = HOST_SAMPLES.map((host, i) => ({
      hostname: host.hostname,
      bestTier: host.bestTier,
      starType: host.starType,
      planetCount: host.planetCount,
      x: HOST_SCALED[i].x,
      y: HOST_SCALED[i].y,
      z: HOST_SCALED[i].z,
    }))

    const planetData = JSON.stringify(samples)
    const galaxyData = JSON.stringify(hostSamples)
    const demoHostData = JSON.stringify({
      hostname: DEMO_HOST.hostname,
      starType: DEMO_HOST.starType,
      entries: DEMO_HOST.entries.slice(0, 1).map((e) => ({
        name: e.name,
        tier: e.tier,
        palette: generatePlanetIdentity(e).visual.surfacePalette,
      })),
    })

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>StarBaron — Star-First 3D Planet Renderer Showcase</title>
<style>
body{margin:0;background:#0b0e1a;color:#e8eaf6;font-family:system-ui,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:28px}
h1{font-size:24px}
.note{font-size:12px;color:#8a93b8;line-height:1.6}
code{background:#1c2338;padding:2px 6px;border-radius:5px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;margin-top:16px}
.card{background:#151a2e;border:1px solid #2a3152;border-radius:14px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:10px}
.name{font-size:16px;font-weight:700;color:#fff}
.meta{font-size:12px;color:#8a93b8;text-align:center}
.tags{font-size:12px;color:#5ab8ff;min-height:18px}
canvas{display:block;border-radius:12px;background:#0b0e1a}
.journey-section{margin-top:28px}
.journey-wrap{height:520px;border:1px solid #2a3152;border-radius:14px;overflow:hidden;position:relative;background:#080a14}
.journey-legend{position:absolute;top:12px;left:12px;background:rgba(11,14,26,0.85);padding:10px 14px;border-radius:10px;font-size:12px;color:#8a93b8}
.journey-legend span{display:inline-block;margin-right:12px}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:4px;vertical-align:middle}
.journey-controls{position:absolute;bottom:12px;left:12px;z-index:5}
.journey-controls button{font-family:monospace;font-size:12px;padding:8px 14px;border-radius:8px;border:1px solid #2a3152;background:#151a2e;color:#8a93b8;cursor:pointer}
.journey-controls button:hover{color:#fff;border-color:#5ab8ff}
</style>
</head>
<body><div class="wrap">
<h1>🪐 StarBaron — Star-First 3D Planet Renderer Showcase</h1>
<p class="note">Deterministic Three.js planets with fBm noise terrain, spectral-class stars, and a star-first galaxy: each dot is a host star. Click a star to approach its seeded system, then click a planet for a close-up. <code>file://</code> safe via CDN importmap.</p>
<div class="grid" id="grid"></div>
<div class="journey-section">
  <h2>🌌 Star-First Galaxy Journey</h2>
  <p class="note">Host stars grouped from the 6,321-planet catalogue (${ALL_HOSTS.length.toLocaleString()} hosts). Colour = best planet tier in the system. Click any host star → seeded solar system → planet.</p>
  <div class="journey-wrap" id="journey-wrap">
    <div class="journey-legend">
      <span><i class="dot" style="background:#4a4a52"></i>T1</span>
      <span><i class="dot" style="background:#6a6a78"></i>T2</span>
      <span><i class="dot" style="background:#8a8a9a"></i>T3</span>
      <span><i class="dot" style="background:#b8a060"></i>T4</span>
      <span><i class="dot" style="background:#ffa040"></i>T5</span>
      <span>click star → system → planet</span>
    </div>
    <div class="journey-controls">
      <button onclick="showcaseBack()">← Back</button>
    </div>
  </div>
</div>
<p class="note" style="margin-top:18px">Generated by <code>tests/showcase-planets-3d.test.ts</code> · inline renderer mirrors <code>src/ui/planetgen3d/render.ts</code> with star-first host grouping from <code>src/ui/planetgen3d/hosts.ts</code>.</p>
<script type="importmap">{ "imports": { "three": "https://unpkg.com/three@0.170.0/build/three.module.js" } }</script>
<script type="application/json" id="planet-data">${planetData}</script>
<script type="application/json" id="galaxy-data">${galaxyData}</script>
<script type="application/json" id="demo-host">${demoHostData}</script>
<script type="module">
import * as THREE from 'three';
${RENDER_JS}
(function () {
  const data = JSON.parse(document.getElementById('planet-data').textContent)
  const grid = document.getElementById('grid')
  for (const planet of data) {
    const card = document.createElement('div')
    card.className = 'card'
    const canvasWrap = document.createElement('div')
    canvasWrap.style.width = '220px'
    canvasWrap.style.height = '220px'
    buildCard(canvasWrap, planet)
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = planet.name
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = [
      planet.starType || 'unknown star',
      planet.distancePc ? planet.distancePc.toFixed(1) + ' pc' : 'distance unknown',
      'Tier ' + planet.tier,
      planet.radiusEarth ? planet.radiusEarth.toFixed(2) + ' R⊕' : '?'
    ].join(' · ')
    const tags = document.createElement('div')
    tags.className = 'tags'
    const t = []
    if (planet.ringed) t.push('🪐 rings')
    if (planet.moons) t.push('🌙 ' + planet.moons + ' moon' + (planet.moons > 1 ? 's' : ''))
    if (planet.atmosphereTint) t.push('☁️ atmosphere')
    tags.textContent = t.join(' · ') || 'no rings · no moons'
    card.append(canvasWrap, name, meta, tags)
    grid.appendChild(card)
  }

  const galaxyData = JSON.parse(document.getElementById('galaxy-data').textContent)
  const demoHost = JSON.parse(document.getElementById('demo-host').textContent)
  const journeyWrap = document.getElementById('journey-wrap')
  initJourney(journeyWrap, galaxyData, demoHost)
})()
</script>
</div></body></html>`

    const out = join(process.cwd(), 'docs', 'showcase-planets-3d.html')
    mkdirSync(join(process.cwd(), 'docs'), { recursive: true })
    writeFileSync(out, html, 'utf8')

    expect(html).toContain('Kepler-452 b')
    expect(html).toContain('HAT-P-64 b')
    expect(html).toContain('Star-First Galaxy Journey')
    expect(html).toContain('buildHostStars')
    expect(html).toContain('https://unpkg.com/three@0.170.0/build/three.module.js')
    expect(ALL_HOSTS.length).toBeGreaterThan(4000)
  })
})
