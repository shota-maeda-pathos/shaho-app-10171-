import { Timestamp } from 'firebase-admin/firestore';
import { ageAtEndOfMonth, isLongTermCareAge, isPensionExcluded, isHealthExcluded } from './age';

function ts(dateStr: string): Timestamp {
  return Timestamp.fromDate(new Date(dateStr + 'T00:00:00Z'));
}

describe('ageAtEndOfMonth', () => {
  it('通常の誕生日（月中）', () => {
    // 1990-04-15 生まれ → 2030-04 末で40歳
    expect(ageAtEndOfMonth(ts('1990-04-15'), '2030-04')).toBe(40);
    // 2030-03 はまだ39歳
    expect(ageAtEndOfMonth(ts('1990-04-15'), '2030-03')).toBe(39);
  });

  it('1日生まれ: 前日が前月末なので前月に年齢到達', () => {
    // 1990-04-01 生まれ → 誕生日前日は3/31 → 2030-03 で40歳
    expect(ageAtEndOfMonth(ts('1990-04-01'), '2030-03')).toBe(40);
    expect(ageAtEndOfMonth(ts('1990-04-01'), '2030-02')).toBe(39);
  });

  it('1月1日生まれ: 前日は前年12/31', () => {
    // 1990-01-01 生まれ → 前日は12/31 → 2029-12末で40歳
    expect(ageAtEndOfMonth(ts('1990-01-01'), '2029-12')).toBe(40);
    expect(ageAtEndOfMonth(ts('1990-01-01'), '2029-11')).toBe(39);
  });

  it('月末生まれ', () => {
    // 1990-03-31 生まれ → 前日3/30 → 2030-03末で40歳
    expect(ageAtEndOfMonth(ts('1990-03-31'), '2030-03')).toBe(40);
    expect(ageAtEndOfMonth(ts('1990-03-31'), '2030-02')).toBe(39);
  });
});

describe('isLongTermCareAge', () => {
  it('40歳到達月からtrue', () => {
    const birth = ts('1990-06-15');
    expect(isLongTermCareAge(birth, '2030-05')).toBe(false);
    expect(isLongTermCareAge(birth, '2030-06')).toBe(true);
  });

  it('65歳到達月からfalse', () => {
    const birth = ts('1965-06-15');
    expect(isLongTermCareAge(birth, '2030-05')).toBe(true);
    expect(isLongTermCareAge(birth, '2030-06')).toBe(false);
  });
});

describe('isPensionExcluded', () => {
  it('70歳以上でtrue', () => {
    const birth = ts('1960-06-15');
    expect(isPensionExcluded(birth, '2030-05')).toBe(false);
    expect(isPensionExcluded(birth, '2030-06')).toBe(true);
  });
});

describe('isHealthExcluded', () => {
  it('75歳以上でtrue', () => {
    const birth = ts('1955-06-15');
    expect(isHealthExcluded(birth, '2030-05')).toBe(false);
    expect(isHealthExcluded(birth, '2030-06')).toBe(true);
  });
});

describe('月の1日生まれ（70歳と75歳で喪失の日が違う）', () => {
  const birth = ts('1955-04-01');
  it('70歳：到達日（3月31日）に喪失し、厚年は2月分まで', () => {
    expect(isPensionExcluded(birth, '2025-02')).toBe(false);
    expect(isPensionExcluded(birth, '2025-03')).toBe(true);
  });
  it('75歳：誕生日（4月1日）に喪失し、健保は3月分まで', () => {
    expect(isHealthExcluded(birth, '2030-03')).toBe(false);
    expect(isHealthExcluded(birth, '2030-04')).toBe(true);
  });
  it('40歳：到達日（3月31日）の月から介護、65歳：到達日の月の前月まで', () => {
    expect(isLongTermCareAge(birth, '1995-02')).toBe(false);
    expect(isLongTermCareAge(birth, '1995-03')).toBe(true);
    expect(isLongTermCareAge(birth, '2020-02')).toBe(true);
    expect(isLongTermCareAge(birth, '2020-03')).toBe(false);
  });
});
