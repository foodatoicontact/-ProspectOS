import {ImageResponse} from 'next/og';

export const alt='ProspectOS — prospection B2B fondée sur des preuves';
export const size={width:1200,height:630};
export const contentType='image/png';

export default function Image(){
  return new ImageResponse(
    <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',justifyContent:'center',padding:'72px 84px',background:'#f7f8f3',color:'#152015',fontFamily:'Arial, sans-serif'}}>
      <div style={{display:'flex',alignItems:'center',gap:18,fontSize:30,fontWeight:700,marginBottom:72}}>
        <div style={{width:62,height:62,borderRadius:18,display:'flex',alignItems:'center',justifyContent:'center',background:'#1f3b29',color:'#d4ee67',fontSize:34,fontWeight:800}}>P</div>
        ProspectOS
      </div>
      <div style={{fontSize:66,lineHeight:1.05,fontWeight:800,letterSpacing:'-2px',maxWidth:980}}>La prospection B2B qui montre ses sources.</div>
      <div style={{fontSize:29,lineHeight:1.4,color:'#687565',marginTop:34,maxWidth:920}}>Scoring explicable · preuves vérifiables · validation humaine.</div>
    </div>,
    size,
  );
}
