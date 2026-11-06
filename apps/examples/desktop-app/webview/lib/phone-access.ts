export type PhoneAccessSetupStep =
	| "install"
	| "sign-in"
	| "turned-off"
	| "magicdns"
	| "operator";

export type PhoneAccessStatus =
	| { state: "off" }
	| { state: "setup-needed"; missing: PhoneAccessSetupStep }
	| { state: "starting" }
	| { state: "running"; url: string; elsewhere: boolean }
	| { state: "blocked" | "unavailable" | "error"; message: string };
