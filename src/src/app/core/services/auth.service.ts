import { Injectable, inject, signal, computed } from '@angular/core';
import { Auth, User, onAuthStateChanged, signInWithEmailAndPassword, signOut } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

export type Role = 'admin' | 'approver' | 'operator' | 'viewer' | 'employee';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  roles: Role[];
  officeIds: string[];
  employeeId: string | null;
  isSuspended: boolean;
  isLoginDisabled: boolean;
  companyId: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);

  private _user = signal<User | null>(null);
  private _profile = signal<UserProfile | null>(null);
  private _loading = signal(true);

  readonly user = this._user.asReadonly();
  readonly profile = this._profile.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);

  readonly companyId = 'company-001';

  constructor() {
    onAuthStateChanged(this.auth, async (user) => {
      this._loading.set(true);
      this._profile.set(null);
      this._user.set(user);
      try {
        if (user) await this.loadProfile(user.uid);
      } catch (error) {
        console.error('ユーザー情報の取得に失敗しました', error);
      } finally {
        this._loading.set(false);
      }
    });
  }

  private async loadProfile(uid: string): Promise<void> {
    const ref = doc(this.firestore, `companies/${this.companyId}/users/${uid}`);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      this._profile.set({
        uid,
        email: data['email'],
        displayName: data['displayName'],
        roles: Array.isArray(data['roles']) ? data['roles'] : [],
        officeIds: data['officeIds'] ?? [],
        employeeId: data['employeeId'] ?? null,
        isSuspended: data['isSuspended'] ?? false,
        isLoginDisabled: data['isLoginDisabled'] ?? false,
        companyId: this.companyId,
      });
    }
  }

  async login(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  hasRole(role: Role): boolean {
    return this._profile()?.roles.includes(role) ?? false;
  }

  hasAnyRole(...roles: Role[]): boolean {
    const userRoles = this._profile()?.roles ?? [];
    return roles.some((r) => userRoles.includes(r));
  }
}
