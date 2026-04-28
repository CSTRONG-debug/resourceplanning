export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ggc: {
          green: "#0f6b3d",
          dark: "#0b3323",
          soft: "#e8f3ed",
          line: "#1f7a4f",
        },
      },
      boxShadow: {
        professional: "0 18px 45px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};
