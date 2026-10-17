'use client';
// UI-1 primitives: Icon, Button, StatusBadge, Chip, ChipGroup. Styling lives in foundations.css and reads only tokens.
import type {ButtonHTMLAttributes,ReactNode,Ref} from 'react';
import {ICONS,type IconName} from './icons.ts';
import {STATUS_META,statusLabelV2,type UiStatus} from './status.ts';
import type {Locale} from '../../i18n/locale.ts';

const cx=(...c:(string|false|null|undefined)[])=>c.filter(Boolean).join(' ');

// Decorative by default (aria-hidden). Give a `label` only when the icon is the sole carrier of meaning.
export function Icon({name,size=20,label,className}:{name:IconName;size?:number;label?:string;className?:string}){
 return <svg className={cx('pos-icon',className)} viewBox="0 0 24 24" width={size} height={size} focusable="false"
  {...(label?{role:'img','aria-label':label}:{'aria-hidden':true})}>
  {ICONS[name].map((d,i)=><path key={i} d={d}/>)}
 </svg>;
}

export type ButtonVariant='primary'|'secondary'|'quiet'|'danger';
export type ButtonSize='sm'|'md'|'lg';
type ButtonProps=Omit<ButtonHTMLAttributes<HTMLButtonElement>,'children'>&{
 variant?:ButtonVariant;size?:ButtonSize;iconStart?:IconName;iconEnd?:IconName;loading?:boolean;fullWidth?:boolean;
 children:ReactNode;ref?:Ref<HTMLButtonElement>};
// One primary per decision (principle 3). Every size keeps a ≥ 44 px hit area (sm extends it with an invisible edge).
// `loading` keeps the label (no layout shift), announces aria-busy and blocks repeated activation.
export function Button({variant='secondary',size='md',iconStart,iconEnd,loading=false,fullWidth=false,className,disabled,type='button',children,ref,...rest}:ButtonProps){
 return <button ref={ref} type={type} {...rest} disabled={disabled||loading} aria-busy={loading||undefined}
  className={cx('pos-btn',`pos-btn--${variant}`,`pos-btn--${size}`,fullWidth&&'pos-btn--full',loading&&'is-loading',className)}>
  {loading?<span className="pos-btn__spinner" aria-hidden="true"/>:iconStart&&<Icon name={iconStart} size={size==='lg'?20:18}/>}
  <span className="pos-btn__label">{children}</span>
  {iconEnd&&!loading&&<Icon name={iconEnd} size={size==='lg'?20:18}/>}
 </button>;
}

// Label + icon + tone: readable without colour. `label` overrides the default wording (same tone and icon).
export function StatusBadge({status,locale='fr',label,className}:{status:UiStatus;locale?:Locale;label?:string;className?:string}){
 return <span className={cx('pos-badge',`pos-badge--${status}`,className)}>
  <Icon name={STATUS_META[status].icon} size={14}/>
  <span>{label??statusLabelV2(status,locale)}</span>
 </span>;
}

export type ChipTone='neutral'|'contact'|'verify'|'engage'|'watch'|'signal';
type ChipProps=Omit<ButtonHTMLAttributes<HTMLButtonElement>,'children'|'onChange'>&{
 pressed:boolean;onPressedChange:(next:boolean)=>void;count?:number;tone?:ChipTone;icon?:IconName;children:ReactNode;ref?:Ref<HTMLButtonElement>};
// A toggle (aria-pressed), e.g. a Today summary filter. The tone dot is a hint; the label always says what it filters.
export function Chip({pressed,onPressedChange,count,tone='neutral',icon,className,children,ref,type='button',...rest}:ChipProps){
 return <button ref={ref} type={type} {...rest} aria-pressed={pressed} onClick={()=>onPressedChange(!pressed)}
  className={cx('pos-chip',`pos-chip--${tone}`,className)}>
  {icon?<Icon name={icon} size={16}/>:tone!=='neutral'&&<span className="pos-chip__dot" aria-hidden="true"/>}
  {count!==undefined&&<b className="pos-chip__count">{count}</b>}
  <span>{children}</span>
 </button>;
}
// `segmented`: one line inside a glass track (Today summary); scrolls inside itself rather than the page at 320 px.
export function ChipGroup({label,variant='wrap',className,children}:{label:string;variant?:'wrap'|'segmented';className?:string;children:ReactNode}){
 return <div role="group" aria-label={label} className={cx('pos-chips',`pos-chips--${variant}`,variant==='segmented'&&'pos-glass',className)}>{children}</div>;
}
