import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy } from '@angular/router';
@Injectable()
export class OfficeRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future:ActivatedRouteSnapshot,current:ActivatedRouteSnapshot):boolean {
    if(future.queryParamMap.get('officeId')!==current.queryParamMap.get('officeId')) return false;
    return super.shouldReuseRoute(future,current);
  }
}
