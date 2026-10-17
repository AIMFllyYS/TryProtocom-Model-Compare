"""Evaluator-only workload fixture; content is unrelated to benchmark answers."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT=Path(__file__).resolve().parents[2]
THREE=ROOT/'workbench/.runtime/complex-render-fixture/node_modules/three'

def add_complex_scene(source, dest):
    version=json.loads((THREE/'package.json').read_text('utf-8'))['version']
    assert version=='0.168.0'
    target=dest/'three-0.168.0.module.js'
    shutil.copyfile(THREE/'build/three.module.js',target)
    source=source.replace('</style>','''
      #root { position: relative; }
      #title { position: absolute; z-index: 2; top: 48px; left: 52px; }
      #diagnostic-three { position: absolute; inset: 0; z-index: 0; }
      .diagnostic-card { position: absolute; z-index: 1; border: 1px solid #4f9eb4;
        color: #bfefff; background: #102a3480; padding: 8px; font-size: 17px; }
    </style>''')
    script='''<script type="module">
      import * as THREE from './three-0.168.0.module.js';
      const root=document.querySelector('#root');
      const scene=new THREE.Scene(); scene.background=new THREE.Color('#08131d');
      const camera=new THREE.PerspectiveCamera(42,1920/1080,.1,120);
      camera.position.set(16,11,19); camera.lookAt(0,0,0);
      const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
      renderer.setSize(1920,1080);renderer.setPixelRatio(1);
      renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      renderer.toneMapping=THREE.ACESFilmicToneMapping;
      renderer.domElement.id='diagnostic-three';root.prepend(renderer.domElement);
      const atlas=document.createElement('canvas');atlas.width=64;atlas.height=64;
      const ctx=atlas.getContext('2d');
      for(let y=0;y<64;y+=8)for(let x=0;x<64;x+=8){ctx.fillStyle=(x+y)%16?'#3896a8':'#223b50';ctx.fillRect(x,y,8,8)}
      const tex=new THREE.CanvasTexture(atlas);tex.colorSpace=THREE.SRGBColorSpace;
      const mat=new THREE.MeshStandardMaterial({map:tex,roughness:.45,metalness:.65});
      const box=new THREE.BoxGeometry(.45,.45,.45);const assembly=new THREE.Group();
      const pieces=[];
      for(let i=0;i<256;i++){
        const m=new THREE.Mesh(box,mat);const ring=Math.floor(i/32),a=(i%32)*Math.PI/16;
        m.position.set((3+ring*.1)*Math.cos(a),ring*.55-2,(3+ring*.1)*Math.sin(a));
        m.castShadow=true;m.receiveShadow=true;assembly.add(m);pieces.push(m);
      }
      scene.add(assembly);
      const floor=new THREE.Mesh(new THREE.PlaneGeometry(50,50),new THREE.MeshStandardMaterial({color:'#162431',roughness:.8}));
      floor.rotation.x=-Math.PI/2;floor.position.y=-3;floor.receiveShadow=true;scene.add(floor);
      scene.add(new THREE.HemisphereLight('#b3eaff','#15131d',2));
      for(let i=0;i<2;i++){
        const l=new THREE.DirectionalLight(i?'#ffc879':'#b6ecff',2.5);
        l.position.set(i?-9:8,14,i?7:-5);l.castShadow=true;l.shadow.mapSize.set(1024,1024);
        l.shadow.camera.left=-12;l.shadow.camera.right=12;l.shadow.camera.top=12;l.shadow.camera.bottom=-12;scene.add(l);
      }
      const lamp=new THREE.PointLight('#57dfff',15,20);lamp.position.set(0,4,0);scene.add(lamp);
      const coords=new Float32Array(512*3);
      for(let i=0;i<512;i++){coords[i*3]=Math.sin(i*2.13)*10;coords[i*3+1]=Math.cos(i*.73)*7;coords[i*3+2]=Math.cos(i*1.81)*10}
      const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.BufferAttribute(coords,3));
      const particles=new THREE.Points(pg,new THREE.PointsMaterial({color:'#f5d89a',size:.065}));scene.add(particles);
      const cards=[];
      for(let i=0;i<32;i++){const c=document.createElement('div');c.className='diagnostic-card';c.textContent='ENV '+String(i).padStart(2,'0');c.style.left=(40+(i%8)*232)+'px';c.style.top=(740+Math.floor(i/8)*65)+'px';root.append(c);cards.push(c)}
      const state={t:0};
      function draw(){
        assembly.rotation.y=state.t*.15;assembly.rotation.x=Math.sin(state.t*.3)*.12;
        particles.rotation.y=-state.t*.05;
        for(let i=0;i<pieces.length;i++)pieces[i].scale.setScalar(1+.12*Math.sin(state.t*2+i*.2));
        cards.forEach((c,i)=>{c.style.transform='translateY('+Math.sin(state.t*1.2+i*.4)*10+'px)';c.style.opacity=String(.5+.5*Math.abs(Math.sin(state.t*.6+i*.1)))});
        renderer.render(scene,camera);
      }
      const timeline=window.__timelines.main;
      timeline.to(state,{t:20,duration:20,ease:'none',onUpdate:draw},0);
      timeline.seek(0);draw();
      window.__diagnosticScene=scene;window.__diagnosticRenderer=renderer;
    </script>'''
    source=source.replace('</body>',script+'\n</body>')
    return source,{'three_version':version,'three_module_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
                  'independent_pbr_box_meshes':256,'particles':512,'animated_dom_cards':32,
                  'shadow_maps':2,'shadow_map_size':1024,'profile_scope':'Single-worker synthetic PBR/DOM workload, not a bound on all future model scenes'}
