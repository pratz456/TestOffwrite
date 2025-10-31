export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  // Check minimum length
  if (password.length < 10) {
    errors.push("Password must be at least 10 characters long");
  }

  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  // Check for at least one special character
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function getPasswordStrength(password: string): 'weak' | 'medium' | 'strong' {
  const validation = validatePassword(password);
  
  if (!validation.isValid) {
    return 'weak';
  }

  // Additional strength checks
  const hasLowercase = /[a-z]/.test(password);
  const hasNumbers = /[0-9]/.test(password);
  const hasMultipleSpecialChars = (password.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/g) || []).length > 1;
  const isLong = password.length >= 12;

  let score = 0;
  if (hasLowercase) score++;
  if (hasNumbers) score++;
  if (hasMultipleSpecialChars) score++;
  if (isLong) score++;

  if (score >= 3) return 'strong';
  if (score >= 2) return 'medium';
  return 'weak';
}
