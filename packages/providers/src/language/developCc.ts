const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
];

export default {
  id: "developCc" as const,
  label: "develop.cc",
  icon: "",
  version: "1.0.0",
  apiUrl: "https://api.develop.cc/v1",
  protocol: "openai-completions",
  rules,
  models: [],
} satisfies ProviderDefinition<typeof rules>;
