import { Injectable, inject, signal, effect, untracked } from '@angular/core';
import { Router, NavigationStart } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthService } from './auth.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm-dialog';

export interface OfficeOption {id:string;name:string}
@Injectable({providedIn:'root'})
export class OfficeContextService {
  private auth=inject(AuthService);private functions=inject(Functions);private router=inject(Router);private confirm=inject(ConfirmService);
  offices=signal<OfficeOption[]>([]); selected=signal('');ready=signal(false);error=signal('');busy=signal(false);
  constructor() {
    effect(()=>{const profile=this.auth.profile(); if(!this.auth.loading()&&profile) untracked(()=>void this.load(profile.uid));else {this.ready.set(false);this.offices.set([]);this.selected.set('');}});
    this.router.events.subscribe(event=>{if(event instanceof NavigationStart&&this.ready()) {
      const id=this.router.parseUrl(event.url).queryParams['officeId'];
      if(id!==undefined) this.restore(id==='all'?'':id);
    }});
  }
  private key(uid:string) {return `shaho.office.${this.auth.companyId}.${uid}`;}
  private restore(id:string) {
    if(id&&!this.offices().some(o=>o.id===id)) {this.error.set('選択した事業所にはアクセスできません。事業所を選び直してください。');return;}
    this.selected.set(id);
  }
  async load(uid=this.auth.profile()?.uid??'') {
    if(!uid) return; this.ready.set(false);this.error.set('');
    if(!this.auth.hasAnyRole('admin','operator','approver','viewer')) {this.ready.set(true);return;}
    try {
      const {data}=await httpsCallable<object,{items:OfficeOption[]}>(this.functions,'officeList')({companyId:this.auth.companyId});
      if(uid!==this.auth.profile()?.uid) return;
      this.offices.set(data.items);
      let stored='';try {stored=sessionStorage.getItem(this.key(uid))??'';}catch{}
      const requested=this.router.parseUrl(this.router.url).queryParams['officeId'];
      const target=requested!==undefined?(requested==='all'?'':requested):stored;
      this.selected.set(target&&data.items.some(o=>o.id===target)?target:data.items.length===1?data.items[0].id:'');
      this.ready.set(true);
    } catch(e:any) {this.error.set('事業所を取得できませんでした。再読み込みしてください。');}
  }
  params():{officeId?:string} {return this.selected()?{officeId:this.selected()}:{};}
  queryParams() {return {officeId:this.selected()||'all'};}
  label() {return this.offices().find(o=>o.id===this.selected())?.name??(this.auth.hasRole('admin')?'全事業所':'担当事業所すべて');}
  async change(id:string) {
    if(id===this.selected()||this.busy()) return;
    if(id&&!this.offices().some(o=>o.id===id)) return;
    if(!(await this.confirm.ask({title:'事業所を切り替える',message:'事業所を切り替えて画面を読み込み直します。',notice:'未保存の入力は失われます。',confirmLabel:'切り替える'}))) return;
    this.selected.set(id);this.error.set('');
    try {sessionStorage.setItem(this.key(this.auth.profile()!.uid),id);}catch{}
    await this.router.navigate([],{queryParams:this.queryParams(),queryParamsHandling:'merge'});
  }
}
