export type CompanyProfile = {
  name: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  abn: string;
  logoUrl: string;
  estimatorName: string;
  estimatorTitle: string;
  estimatorPhone: string;
  email: string;
  bankName: string;
  bsb: string;
  acc: string;
  bank: string;
};
export type Contact = {
  id?: string;
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postal: string;
};
export type JobAddress = { address: string; city: string; state: string; postal: string };

export const DEFAULT_COMPANY: CompanyProfile = {
  name: "Paint Group",
  addressLine1: "25/25-35 Bunney Road",
  addressLine2: "Oakleigh South, VIC 3167",
  phone: "03 8840 9414",
  abn: "41 639 780 108",
  logoUrl: "",
  estimatorName: "Tom Roman",
  estimatorTitle: "Director",
  estimatorPhone: "0422 453 136",
  email: "info@paintgroup.com.au",
  bankName: "ENLVN Pty Ltd",
  bsb: "063-143",
  acc: "1064 4591",
  bank: "Commonwealth Bank",
};
export const EMPTY_CONTACT: Contact = {
  first_name: "", last_name: "", company: "", email: "", phone: "", address: "", city: "", state: "", postal: "",
};
export const EMPTY_JOB: JobAddress = { address: "", city: "", state: "", postal: "" };
