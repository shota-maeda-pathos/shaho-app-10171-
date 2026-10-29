import { Injectable, inject } from '@angular/core';
import { Auth, multiFactor, PhoneAuthProvider, PhoneMultiFactorGenerator, RecaptchaVerifier } from '@angular/fire/auth';

@Injectable({ providedIn: 'root' })
export class MfaService {
  private auth = inject(Auth);

  isEnrolled(): boolean {
    const user = this.auth.currentUser;
    if (!user) return false;
    return multiFactor(user).enrolledFactors.length > 0;
  }

  getEnrolledFactors() {
    const user = this.auth.currentUser;
    if (!user) return [];
    return multiFactor(user).enrolledFactors;
  }

  async startPhoneEnrollment(phoneNumber: string, recaptchaContainer: string): Promise<string> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('ログインが必要です');

    const recaptchaVerifier = new RecaptchaVerifier(this.auth, recaptchaContainer, { size: 'invisible' });
    const session = await multiFactor(user).getSession();
    const phoneInfoOptions = { phoneNumber, session };
    const phoneAuthProvider = new PhoneAuthProvider(this.auth);
    return phoneAuthProvider.verifyPhoneNumber(phoneInfoOptions, recaptchaVerifier);
  }

  async completePhoneEnrollment(verificationId: string, verificationCode: string, displayName?: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('ログインが必要です');

    const credential = PhoneAuthProvider.credential(verificationId, verificationCode);
    const multiFactorAssertion = PhoneMultiFactorGenerator.assertion(credential);
    await multiFactor(user).enroll(multiFactorAssertion, displayName ?? '電話番号');
  }

  async unenroll(factorUid: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('ログインが必要です');

    const factor = multiFactor(user).enrolledFactors.find((f) => f.uid === factorUid);
    if (!factor) throw new Error('指定された認証要素が見つかりません');
    await multiFactor(user).unenroll(factor);
  }
}
