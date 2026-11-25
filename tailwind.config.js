/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#202622",
        muted: "#7b837e",
        canvas: "#f7f8f6",
        green: {
          50: "#edf5ef",
          100: "#dcecdf",
          500: "#43815b",
          600: "#356c4a",
        },
      },
      boxShadow: {
        card: "0 2px 10px rgba(27, 38, 29, 0.035), 0 18px 50px rgba(27, 38, 29, 0.035)",
      },
    },
  },
  plugins: [],
};
