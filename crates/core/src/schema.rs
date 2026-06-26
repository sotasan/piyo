// @generated automatically by Diesel CLI.

diesel::table! {
    repositories (id) {
        id -> Text,
        path -> Text,
        position -> Integer,
    }
}

diesel::table! {
    sessions (id) {
        id -> Text,
        repository_id -> Text,
        worktree_path -> Text,
        position -> Integer,
    }
}

diesel::joinable!(sessions -> repositories (repository_id));

diesel::allow_tables_to_appear_in_same_query!(repositories, sessions,);
