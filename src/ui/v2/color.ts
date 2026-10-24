// Colour arithmetic for the v2 tokens: alpha variants are derived from the palette instead of being written by hand,
// and contrast is measured (WCAG 2.x relative luminance) the way a browser composites a translucent colour.
export type Rgba={r:number;g:number;b:number;a:number};

export function parseColor(c:string):Rgba{
 const s=c.trim();
 let m=/^#([0-9a-f]{6})$/i.exec(s);
 if(m){const n=parseInt(m[1]!,16);return {r:n>>16&255,g:n>>8&255,b:n&255,a:1}}
 m=/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
 if(m)return {r:+m[1]!,g:+m[2]!,b:+m[3]!,a:m[4]===undefined?1:+m[4]};
 throw new Error(`unsupported colour: ${c}`);
}
// "#4338CA" at 9 % → "rgba(67,56,202,0.09)".
export function alpha(hex:string,a:number):string{
 const {r,g,b}=parseColor(hex);
 return `rgba(${r},${g},${b},${+a.toFixed(3)})`;
}
// Source-over compositing of `top` on `bottom`, as the browser paints a translucent surface.
export function composite(top:string|Rgba,bottom:string|Rgba):Rgba{
 const t=typeof top==='string'?parseColor(top):top,b=typeof bottom==='string'?parseColor(bottom):bottom;
 const a=t.a+b.a*(1-t.a);
 if(a===0)return {r:0,g:0,b:0,a:0};
 const ch=(x:number,y:number)=>(x*t.a+y*b.a*(1-t.a))/a;
 return {r:ch(t.r,b.r),g:ch(t.g,b.g),b:ch(t.b,b.b),a};
}
function luminance(c:Rgba):number{
 const lin=(v:number)=>{const s=v/255;return s<=0.03928?s/12.92:((s+0.055)/1.055)**2.4};
 return 0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);
}
export function contrastRatio(fg:string|Rgba,bg:string|Rgba):number{
 const b=typeof bg==='string'?parseColor(bg):bg;
 const f=composite(fg,b);
 const [hi,lo]=[luminance(f),luminance(b)].sort((x,y)=>y-x) as [number,number];
 return (hi+0.05)/(lo+0.05);
}
