let user = {
  id: "fixture-user",
  email: "aina@example.test",
  user_metadata: { full_name: "Aina" },
  last_sign_in_at: "2026-11-03T01:30:00Z",
};
export const supabase = {
  auth: {
    async getUser() {
      return { data: { user: structuredClone(user) }, error: null };
    },
    async updateUser(input: {
      data?: Record<string, unknown>;
      password?: string;
    }) {
      if (input.data)
        user.user_metadata = { ...user.user_metadata, ...input.data };
      return { data: { user: structuredClone(user) }, error: null };
    },
    async reauthenticate() {
      return { error: null };
    },
    async signOut() {
      return { error: null };
    },
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
  },
};
