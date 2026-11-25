// Programme partenaires (052) — the shapes returned by partner_space() and partner_admin_overview(), for the two screens.
export type SpaceLine={client:string;kind:'COMMISSION'|'REFUND';amount_cents:number;base_ht_cents:number|null;occurred_at:string};
export type Paid={paid_on:string;reference:string;amount_cents:number}|null;
export type SpaceStatement={id:string;month:string;referred_count:number;paying_clients:number;payments_count:number;month_commissions_cents:number;balance_cents:number;payable:boolean;paid:Paid};
export type SpaceData={partner:{name:string;company:string;code:string;rate_percent:number;status:'ACTIVE'|'SUSPENDED'};link:string;signups:number;paying_clients:number;
 month:string;month_commissions_cents:number;balance_cents:number;threshold_cents:number;lines:SpaceLine[];statements:SpaceStatement[]};
export type AdminPartner={id:string;name:string;company:string;siret:string;email:string;code:string;rate_percent:number;status:'ACTIVE'|'SUSPENDED';has_account:boolean;created_at:string;
 signups:number;paying_clients:number;earned_cents:number;paid_cents:number;balance_cents:number};
export type ToPay={id:string;partner_id:string;partner:string;code:string;month:string;balance_cents:number;month_commissions_cents:number};
export type Application={id:string;name:string;company:string;siret:string;email:string;pitch:string;created_at:string;is_partner:boolean};
export type AdminData={partners:AdminPartner[];to_pay:ToPay[];statements:(SpaceStatement&{partner_id:string})[];applications:Application[]};
// What a statement means for the partner: paid, to be paid (from 50 €), or carried over to the next month.
export function statementState(s:Pick<SpaceStatement,'payable'|'paid'>,latest:boolean):'PAID'|'TO_PAY'|'CARRIED'|'INCLUDED_LATER'{
 if(s.paid)return 'PAID';
 if(!latest)return 'INCLUDED_LATER';
 return s.payable?'TO_PAY':'CARRIED';
}
export const STATE_LABEL={PAID:'Payé',TO_PAY:'À payer',CARRIED:'Reporté (moins de 50 €)',INCLUDED_LATER:'Repris au relevé suivant'} as const;
