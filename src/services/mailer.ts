export type AuthMail = {
  email: string;
  token: string;
};

export type AuthMailer = {
  sendEmailVerification: (mail: AuthMail) => Promise<void>;
  sendPasswordReset: (mail: AuthMail) => Promise<void>;
};
