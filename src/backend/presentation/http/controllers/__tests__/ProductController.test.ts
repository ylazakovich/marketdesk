import { parseStringList } from '../ProductController';

describe('ProductController list parsing', () => {
  it('preserves commas inside JSON-encoded tag values', () => {
    expect(parseStringList('["home, office","featured"]')).toEqual(['home, office', 'featured']);
  });

  it('keeps backward compatibility with comma-separated tags', () => {
    expect(parseStringList('audio, featured')).toEqual(['audio', 'featured']);
  });

  it('fails closed for malformed JSON arrays', () => {
    expect(parseStringList('["unterminated"')).toBeUndefined();
    expect(parseStringList('["valid", 2]')).toBeUndefined();
  });
});
