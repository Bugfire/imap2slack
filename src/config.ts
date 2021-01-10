type FilterReplace = Readonly<{
  regex: string;
  replace: string;
}>;

type FilterDeny = Readonly<{
  cond: "deny";
  from?: string;
  subject?: string;
  body?: string;
}>;

type FilterAllow = Readonly<{
  cond: "allow";
  from?: string;
  subject?: string;
  body?: string;
  subjectFilter?: FilterReplace;
  bodyFilter?: FilterReplace;
}>;

export type Config = Readonly<{
  mail: {
    host: string;
    auth: {
      user: string;
      pass: string;
    };
  };
  slack: {
    channel_id: string;
    token: string;
  };
  filter: (FilterAllow | FilterDeny)[];
  debug?: boolean;
  dryrun?: boolean;
}>;
