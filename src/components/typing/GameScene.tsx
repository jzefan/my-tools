/** A quiet, isometric keyboard dock. Vector geometry stays crisp at any display scale. */
export function GameScene() {
  const origin = { x: 942, y: 278 };
  const project = (x: number, y: number, z = 0) => [origin.x + x * 1.03 - y * 0.92, origin.y + x * 0.34 + y * 0.49 - z];
  const points = (vertices: number[][]) => vertices.map(([x, y, z]) => project(x, y, z).join(',')).join(' ');
  const keys = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  return (
    <svg className="tg-scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="tg-sky" x2="0" y2="1"><stop stopColor="#202a2c"/><stop offset=".56" stopColor="#121b1e"/><stop offset="1" stopColor="#0c1114"/></linearGradient>
        <radialGradient id="tg-haze"><stop stopColor="#b4aa85" stopOpacity=".13"/><stop offset="1" stopColor="#b4aa85" stopOpacity="0"/></radialGradient>
        <linearGradient id="tg-veil"><stop stopColor="#0b0f12" stopOpacity=".96"/><stop offset=".43" stopColor="#0b0f12" stopOpacity=".65"/><stop offset="1" stopColor="#0b0f12" stopOpacity="0"/></linearGradient>
      </defs>
      <path fill="url(#tg-sky)" d="M0 0h1600v1000H0z"/>
      <ellipse cx="1140" cy="330" rx="650" ry="360" fill="url(#tg-haze)"/>
      <g stroke="#687370" strokeWidth="1" opacity=".18" fill="none">
        <path d="M0 380H1600M0 392H1600"/>
        {Array.from({length: 18}, (_, i) => <path key={i} d={`M${650 + i * 60} 392L${-1800 + i * 360} 1200`}/>)}
        {[420, 458, 510, 580, 675, 810, 995].map(y => <path key={y} d={`M0 ${y}H1600`}/>)}
      </g>
      <g fill="#111a1d" stroke="#52605e" strokeOpacity=".3">
        <path d="M810 380v-54h42v54m4 0v-82h24v82m105 0V270h67v110m181 0v-44h120v44m-93 0V232h34v148"/>
        <path d="M1193 380V180l-130 18v12l259-19v-13l-129 2m-8 30-52 170m68-170 48 170m-186-170v72m225-83v95" fill="none" strokeWidth="3"/>
        <path d="M1422 380V223l-90 12v10l205-18v-10l-115 6m-4 26-37 131m47-133 38 133" fill="none" strokeWidth="2"/>
      </g>
      <g fill="#e5aa61"><circle cx="1193" cy="179" r="2"/><circle cx="1422" cy="221" r="2"/></g>
      <g className="tg-dock">
        <polygon points={points([[-28,-30,-28],[545,-30,-28],[545,330,-28],[-28,330,-28]])} fill="#0a1013" stroke="#3c4949"/>
        <polygon points={points([[-28,330,0],[545,330,0],[545,330,-28],[-28,330,-28]])} fill="#111b20" stroke="#43504f"/>
        <polygon points={points([[545,-30,0],[545,330,0],[545,330,-28],[545,-30,-28]])} fill="#0d1518" stroke="#43504f"/>
        <polygon points={points([[-28,-30,0],[545,-30,0],[545,330,0],[-28,330,0]])} fill="#202d32" stroke="#61706b"/>
        {keys.flatMap((row, r) => [...row].map((key, c) => {
          const x = c * 51 + r * 16, y = r * 76 + 12, w = 43, d = 57, h = key === 'F' || key === 'J' ? 42 : 34;
          const on = key === 'E';
          const center = project(x + w / 2, y + d / 2, h + 1);
          return <g key={key}>
            <polygon points={points([[x,y+d,h],[x+w,y+d,h],[x+w,y+d,0],[x,y+d,0]])} fill={on ? '#9a6732' : '#1a2429'} stroke="#4f5c5c" strokeWidth=".6"/>
            <polygon points={points([[x+w,y,h],[x+w,y+d,h],[x+w,y+d,0],[x+w,y,0]])} fill={on ? '#6d4c2c' : '#101a1f'} stroke="#3e4c4e" strokeWidth=".6"/>
            <polygon points={points([[x,y,h],[x+w,y,h],[x+w,y+d,h],[x,y+d,h]])} fill={on ? '#d4a05d' : '#35434a'} stroke={on ? '#f6d395' : '#65736f'} strokeWidth=".8"/>
            <text x={center[0]} y={center[1]} textAnchor="middle" dominantBaseline="middle" fill={on ? '#30291e' : '#a8b0a6'} fontSize="17" fontFamily="monospace" transform={`rotate(18 ${center[0]} ${center[1]})`}>{key}</text>
          </g>;
        }))}
        <polygon points={points([[115,249,18],[370,249,18],[370,298,18],[115,298,18]])} fill="#3c4b50" stroke="#758078"/>
        <polygon points={points([[115,298,18],[370,298,18],[370,298,0],[115,298,0]])} fill="#1a252b" stroke="#52615e"/>
        <polygon points={points([[370,249,18],[370,298,18],[370,298,0],[370,249,0]])} fill="#162027"/>
        <polyline points={points([[-17,312,1],[88,312,1],[88,239,1],[526,239,1],[526,310,1]])} fill="none" stroke="#d0a05e" strokeWidth="2" opacity=".75"/>
        {[0,1,2,3,4].map(i => <polygon key={i} points={points([[459+i*12,286,1],[464+i*12,286,1],[464+i*12,301,1],[459+i*12,301,1]])} fill="#c79d60" opacity=".7"/>)}
      </g>
      <g stroke="#b99458" fill="none" opacity=".38"><circle cx="1070" cy="625" r="206" strokeDasharray="2 18"/><path d="M862 625h-14m444 0h-14M1070 403v14m0 416v14"/></g>
      <path fill="url(#tg-veil)" d="M0 0h1600v1000H0z"/>
    </svg>
  );
}
