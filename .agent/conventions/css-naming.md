# CSS class naming convention

Every component in `src/components/` prefixes all classes in its CSS file with `ui-<component-name-in-kebab-case>`. This applies unconditionally, regardless of whether the component's styling happens to be domain-specific.

Rules:
- Prefix: component name converted to kebab-case, prepended with `ui-`.
- Sub-element and state classes append a descriptive suffix to the component prefix, separated by `-`.
- The prefix is derived only from the component name — never from usage context, feature, or domain.
