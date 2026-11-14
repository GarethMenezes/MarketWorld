const moments = [
{date:"2007-09-18",short:"2007",name:"The fragile world",title:"A little relief.<br>A deeper fracture.",phase:"EARLY WARNING",risk:false,weather:"Gathering clouds",tone:.24,drift:.15,
summary:"The Federal Reserve cuts its target interest rate by half a percentage point. Beneath the relief, the housing and credit systems are already under strain.",
good:"<strong>A policy cushion.</strong> Lower rates aim to soften the damage from disrupted credit markets and support economic growth.",
bad:"<strong>The cracks are real.</strong> Tighter credit threatens to deepen the housing downturn. The Fed says the economic outlook has become more uncertain.",
insight:"World metaphor: a green-blue planet with three satellites for opportunity, pressure and uncertainty. A helpful response can coexist with growing risk.",
source:"Federal Reserve",url:"https://www.federalreserve.gov/newsevents/pressreleases/monetary20070918a.htm"},
{date:"2008-09-15",short:"2008",name:"The fractured world",title:"When the ground<br>gave way.",phase:"FINANCIAL CRISIS",risk:true,weather:"System-wide storm",tone:.95,drift:.88,
summary:"Lehman Brothers files for bankruptcy. The mortgage crisis becomes a wider crisis of confidence, and financial stress spreads through the economy.",
good:"<strong>A response takes shape.</strong> Over the crisis, emergency liquidity programmes seek to keep finance functioning. These are stabilisation efforts, not an immediate recovery.",
bad:"<strong>Damage spreads.</strong> Financial disruption and the housing downturn feed a severe recession, affecting jobs, businesses and households.",
insight:"World metaphor: a scorched planet and tighter satellite orbits illustrate shared exposure to a crisis. Orbits are not measured correlations.",
source:"Federal Reserve History",url:"https://www.federalreservehistory.org/essays/great-recession-and-its-aftermath"},
{date:"2009-03-18",short:"2009",name:"The rebuilding world",title:"The first signs<br>of a new world.",phase:"POLICY SUPPORT",risk:false,weather:"Light through the storm",tone:.43,drift:.55,
summary:"The Fed expands its asset purchases, including up to $300 billion of longer-term Treasuries, to help improve credit conditions.",
good:"<strong>Support for lending.</strong> Additional mortgage-backed security and agency debt purchases aim to support housing and the flow of credit.",
bad:"<strong>Recovery is not here yet.</strong> The Fed reports continued economic contraction, job losses, shrinking wealth and tight credit.",
insight:"World metaphor: green begins to return, but the terrain remains scarred. A rescue measure and a healthy economy are different things.",
source:"Federal Reserve",url:"https://www.federalreserve.gov/newsevents/pressreleases/monetary20090318a.htm"},
{date:"2020-03-23",short:"MAR ’20",name:"The paused world",title:"An economy<br>put on pause.",phase:"PANDEMIC SHOCK",risk:true,weather:"A sudden global storm",tone:.9,drift:.95,
summary:"As the pandemic disrupts everyday life, the Federal Reserve announces extensive measures to support market functioning and the flow of credit.",
good:"<strong>A financial bridge.</strong> New facilities and asset purchases aim to keep credit reaching households, employers and businesses.",
bad:"<strong>A human and economic shock.</strong> The pandemic causes tremendous hardship. Financial support cannot by itself resolve the health emergency.",
insight:"World metaphor: a cold, dark planet and tighter satellite orbits represent a common shock. This is a historical chapter, not a daily return chart.",
source:"Federal Reserve",url:"https://www.federalreserve.gov/newsevents/pressreleases/monetary20200323b.htm"},
{date:"2020-11-09",short:"NOV ’20",name:"The reopening world",title:"A way back<br>into the light.",phase:"VACCINE BREAKTHROUGH",risk:false,weather:"A brighter horizon",tone:.15,drift:.25,
summary:"Pfizer and BioNTech announce positive interim vaccine results, opening a possible route towards controlling the pandemic.",
good:"<strong>Evidence of a way forward.</strong> The initial analysis reports more than 90% efficacy in participants without prior evidence of infection.",
bad:"<strong>Still an interim result.</strong> Safety data collection continues, authorisation is still ahead, and manufacturing and distribution remain major tasks.",
insight:"World metaphor: open green terrain represents renewed possibility. This reflects the announcement, not a claim that all sectors recovered together.",
source:"Pfizer / BioNTech",url:"https://www.pfizer.com/news/press-release/press-release-detail/pfizer-and-biontech-announce-vaccine-candidate-against"},
{date:"2022-06-15",short:"2022",name:"The pressure world",title:"The cost<br>of cooling down.",phase:"INFLATION & RATES",risk:true,weather:"Heat across the landscape",tone:.72,drift:.55,
summary:"The Fed raises its target interest-rate range by 0.75 percentage points, to 1.50–1.75%, while inflation remains elevated.",
good:"<strong>A price-stability goal.</strong> The policy aims to bring inflation back towards 2%, protecting purchasing power over time.",
bad:"<strong>A difficult trade-off.</strong> Higher rates can raise financing costs. The statement also flags war-related price pressures and supply-chain disruption.",
insight:"Interpretation: tighter finance can put pressure on borrowers and investment. The red terrain illustrates that trade-off; it is not a sector performance measure.",
source:"Federal Reserve",url:"https://www.federalreserve.gov/newsevents/pressreleases/monetary20220615a.htm"},
{date:"2023-05-24",short:"2023",name:"The accelerated world",title:"A new frontier.<br>Uneven ground.",phase:"THE AI FRONTIER",risk:false,weather:"A new frontier emerging",tone:.12,drift:.12,
summary:"NVIDIA reports record quarterly Data Center revenue of $4.28 billion as accelerated computing and generative AI become a major business focus.",
good:"<strong>A growing frontier.</strong> The company reports rising demand and plans to increase supply. Data Center revenue reaches a record.",
bad:"<strong>The picture is mixed.</strong> Total quarterly revenue is still down 13% year on year. Strength in one business does not mean universal growth.",
insight:"World metaphor: a luminous teal world represents an emerging frontier. Its surface and rings are illustrative, not stock returns or market values.",
source:"NVIDIA investor relations",url:"https://investor.nvidia.com/news/press-release-details/2023/NVIDIA-Announces-Financial-Results-for-First-Quarter-Fiscal-2024/default.aspx"}
];
const initialDate=new URLSearchParams(location.search).get("date") || new URLSearchParams(location.search).get("week");
const $=id=>document.getElementById(id);
const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
const dateLabel=d=>new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(d+"T12:00:00Z")).toUpperCase();
$("chapters").innerHTML=moments.map((m,i)=>`<article id="world-${i}" data-index="${i}" aria-labelledby="title-${i}"><div class="chapter-meta"><span class="number">${String(i+1).padStart(2,"0")}</span><time datetime="${m.date}">${dateLabel(m.date)}</time></div><span class="phase ${m.risk?"risk":""}">${m.phase}</span><h2 id="title-${i}">${m.title}</h2><p class="summary">${m.summary}</p><div class="outcome"><span class="symbol" aria-hidden="true">↗</span><div><h3>THE GOOD / OPPORTUNITY</h3><p>${m.good}</p></div></div><div class="outcome bad"><span class="symbol" aria-hidden="true">↘</span><div><h3>THE BAD / PRESSURE</h3><p>${m.bad}</p></div></div><div class="source"><span>HISTORICAL EVENT · ${String(i+1).padStart(2,"0")}</span><a href="${m.url}" target="_blank" rel="noopener noreferrer">${m.source} ↗</a></div><p class="interpretation">${m.insight}</p><button class="chapter-next" data-go="${i===moments.length-1?0:i+1}"><span>${i===moments.length-1?"Explore the journey again":"Next world · "+dateLabel(moments[i+1].date)}</span><span aria-hidden="true">${i===moments.length-1?"↑":"↓"}</span></button></article>`).join("");
$("ticks").innerHTML=moments.map((m,i)=>`<button data-go="${i}" aria-label="Go to ${dateLabel(m.date)}">${m.short}</button>`).join("");
let current=0,playTimer=null,autoRotate=!reduced;
const chapters=[...document.querySelectorAll("article")];
function select(i){current=Math.max(0,Math.min(moments.length-1,i));const m=moments[current];$("timeline").value=current;$("timeline").setAttribute("aria-valuetext",dateLabel(m.date)+", "+m.name);$("current-date").textContent=dateLabel(m.date);$("counter").textContent=String(current+1).padStart(2,"0")+" / 07";$("world-number").textContent=String(current+1).padStart(2,"0");$("planet-tag").textContent=m.name.toUpperCase();$("weather").innerHTML="<i></i>"+m.weather;$("weather").style.color=m.risk?"var(--red)":"var(--green)";$("previous").disabled=current===0;$("next").disabled=current===moments.length-1;document.querySelectorAll("#ticks button").forEach((b,k)=>b.setAttribute("aria-current",String(k===current)));$("announcement").textContent=dateLabel(m.date)+". "+m.name;const url=new URL(location.href);url.searchParams.set("date",m.date);history.replaceState(null,"",url);if(current===moments.length-1)stopPlay();}
function go(i){select(i);chapters[current].scrollIntoView({behavior:reduced?"instant":"smooth",block:"start"});}
function stopPlay(){clearInterval(playTimer);playTimer=null;$("play").innerHTML="▶ <span>Play journey</span>";$("play").setAttribute("aria-label","Play guided journey");}
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>{stopPlay();go(Number(b.dataset.go));}));
$("previous").onclick=()=>{stopPlay();go(current-1);};$("next").onclick=()=>{stopPlay();go(current+1);};$("restart").onclick=()=>{stopPlay();go(0);};$("timeline").oninput=e=>{stopPlay();go(Number(e.target.value));};
$("play").onclick=()=>{if(playTimer){stopPlay();return;}if(current===moments.length-1)go(0);else go(current);$("play").innerHTML="Ⅱ <span>Pause journey</span>";$("play").setAttribute("aria-label","Pause guided journey");playTimer=setInterval(()=>{if(document.hidden||$("about-dialog").open)return;go(current+1);},10000);};
let ticking=false;addEventListener("scroll",()=>{if(ticking)return;ticking=true;requestAnimationFrame(()=>{const anchor=innerWidth<=800?Math.max(360,innerHeight*.46):innerHeight*.36;let best=0,distance=Infinity;chapters.forEach((c,i)=>{const r=c.getBoundingClientRect();const d=r.top<=anchor&&r.bottom>=anchor?0:Math.min(Math.abs(r.top-anchor),Math.abs(r.bottom-anchor));if(d<distance){distance=d;best=i;}});if(best!==current)select(best);ticking=false;});},{passive:true});
$("about").onclick=()=>{$("about-dialog").showModal();};$("close-about").onclick=()=>$("about-dialog").close();
$("about-dialog").addEventListener("click",e=>{if(e.target===$("about-dialog")){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
function updateRotationButton(){$("rotate").textContent=autoRotate?"Ⅱ":"▶";$("rotate").setAttribute("aria-label",autoRotate?"Pause planet rotation":"Resume planet rotation");$("rotate").setAttribute("aria-pressed",String(!autoRotate));}
$("rotate").onclick=()=>{autoRotate=!autoRotate;updateRotationButton();};updateRotationButton();
document.querySelector(".brand").onclick=e=>{e.preventDefault();stopPlay();go(0);};
select(0);
if(initialDate){const match=moments.findIndex(m=>m.date>=initialDate);requestAnimationFrame(()=>go(match<0?moments.length-1:match));}

const canvas=$("planet");
const worldStyles=[
 {ocean:[.035,.14,.22],land:[.21,.49,.29],accent:[.55,.87,.68],seed:1.3,stress:.05,ringRadius:1.40,ringWidth:.035},
 {ocean:[.075,.025,.025],land:[.29,.075,.045],accent:[1,.31,.12],seed:4.1,stress:.95,ringRadius:1.36,ringWidth:.24},
 {ocean:[.035,.19,.20],land:[.24,.48,.33],accent:[.57,.91,.74],seed:2.3,stress:.18,ringRadius:1.44,ringWidth:.09},
 {ocean:[.025,.06,.13],land:[.20,.31,.40],accent:[.62,.80,1],seed:6.8,stress:.30,ringRadius:1.35,ringWidth:.05},
 {ocean:[.025,.15,.24],land:[.27,.54,.31],accent:[.60,.90,.65],seed:3.7,stress:.01,ringRadius:1.46,ringWidth:.075},
 {ocean:[.12,.055,.025],land:[.56,.29,.09],accent:[1,.65,.25],seed:8.2,stress:.6,ringRadius:1.46,ringWidth:.25},
 {ocean:[.025,.075,.16],land:[.10,.38,.40],accent:[.30,.94,.87],seed:5.3,stress:.08,ringRadius:1.48,ringWidth:.13}
];
const moonColors=[[.63,.79,.72],[.83,.52,.39],[.52,.65,.84]];
let planetView=null;
const fallback=$("planet-fallback");
function showFallback(message){fallback.hidden=false;fallback.querySelector("p").textContent=message;canvas.style.visibility="hidden";}
canvas.addEventListener("planet3d-unavailable",()=>showFallback("The 3D view was interrupted. Your timeline still works; reload to restore the planets."));
canvas.addEventListener("planet3d-ready",()=>{fallback.hidden=true;canvas.style.visibility="visible";});
fallback.hidden=false;fallback.querySelector("p").textContent="Loading your world…";
RealtimePlanetView.create(canvas).then(view=>{planetView=view;fallback.hidden=true;updatePlanet();}).catch(error=>{
 showFallback("The detailed 3D view needs WebGL 2 and a local or hosted web server. Your dated timeline still works.");
 console.warn("Realtime planet shader unavailable:",error.message);
});
function updatePlanet(){
 if(!planetView)return;
 const m=moments[current],style=worldStyles[current];
 planetView.setWorld({...style,name:m.name,moons:moonColors.map((color,i)=>({
   name:["Opportunity","Pressure","Uncertainty"][i],color,radius:[.105,.14,.075][i],
   orbit:1.75+i*.16-m.drift*.13,speed:[.14,-.09,.19][i],angle:[35,165,275][i]
 }))},current);
}
$("zoom-in").onclick=()=>planetView?.zoom(-.25);
$("zoom-out").onclick=()=>planetView?.zoom(.25);
updatePlanet();
let previousTime=0;
function draw(now){requestAnimationFrame(draw);const dt=Math.min((now-previousTime)/1000,.05);previousTime=now;
 if(document.hidden||!planetView)return;
 updatePlanet();planetView.render(dt,autoRotate&&!$("about-dialog").open);
}
requestAnimationFrame(draw);
