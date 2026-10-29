import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

const APP_NAME = '社会保険管理システム';

/** ブラウザーのタブ名を「画面名｜社会保険管理システム」にする。画面名はルートの data.title（いちばん深いもの） */
@Injectable()
export class PageTitleStrategy extends TitleStrategy {
  private title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot) {
    let route = snapshot.root;
    let pageTitle: string | undefined = this.buildTitle(snapshot);
    while (route) {
      if (typeof route.data['title'] === 'string') pageTitle = route.data['title'];
      route = route.firstChild!;
    }
    this.title.setTitle(pageTitle ? `${pageTitle}｜${APP_NAME}` : APP_NAME);
  }
}
