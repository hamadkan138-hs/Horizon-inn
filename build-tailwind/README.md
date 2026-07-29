Source config for `public/room-management-compiled.css`.

`room-management.html` used to load Tailwind via the `cdn.tailwindcss.com`
Play CDN, which Tailwind's own docs say isn't meant for production and which
leaves the page completely unstyled if that CDN is ever unreachable. This
directory pre-compiles the same utility classes into a static stylesheet
instead.

If you change Tailwind classes in `public/room-management.html` or
`public/room-management.js`, regenerate the compiled CSS:

```
npm run build:room-management-css
```
