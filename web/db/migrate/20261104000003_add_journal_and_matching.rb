class AddJournalAndMatching < ActiveRecord::Migration[8.0]
  def change
    # ---- Journal: the Fellow's own notes. Private unless they choose to share.
    create_table :journal_prompts do |t|
      t.references :fellow, null: false, foreign_key: true
      t.references :author, null: false, foreign_key: { to_table: :users } # the historian or an admin
      t.text :text, null: false
      t.datetime :dismissed_at # the Fellow said "not now"
      t.timestamps
    end

    create_table :journal_entries do |t|
      t.references :fellow, null: false, foreign_key: true
      t.references :era, foreign_key: { on_delete: :nullify }
      t.references :journal_prompt, foreign_key: { on_delete: :nullify }
      t.text :body
      t.date :written_on, null: false
      t.boolean :shared_with_historian, null: false, default: false
      t.timestamps
      t.index [ :fellow_id, :written_on ]
    end

    # ---- Matching a Fellow with a historian. Both sides must say yes; an admin confirms.
    create_table :historian_profiles do |t|
      t.references :user, null: false, foreign_key: true, index: { unique: true }
      t.string :headline
      t.text :bio
      t.string :languages
      t.string :regions
      t.string :specialties
      t.boolean :accepting, null: false, default: true
      t.timestamps
    end

    add_reference :fellows, :historian, foreign_key: { to_table: :users }
    add_column :fellows, :seeking_historian, :boolean, null: false, default: false
    add_column :fellows, :match_intro, :text
    add_column :fellows, :languages, :string

    create_table :match_interests do |t|
      t.references :fellow, null: false, foreign_key: true
      t.references :historian, null: false, foreign_key: { to_table: :users }
      t.boolean :fellow_wants, null: false, default: false
      t.boolean :historian_wants, null: false, default: false
      t.string :status, null: false, default: "open" # open | confirmed | declined | closed
      t.references :decided_by, foreign_key: { to_table: :users }
      t.datetime :decided_at
      t.timestamps
      t.index [ :fellow_id, :historian_id ], unique: true
    end
  end
end
