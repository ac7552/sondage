class AddHeirsAndInterviewParts < ActiveRecord::Migration[8.0]
  def change
    # ---- Heirs: family helpers the Fellow allows to open the recordings after death.
    # They already hold a safety copy; after Sondage confirms the death and a waiting
    # period passes, their copy plus Sondage's rebuilds the key on the heir's computer.
    add_column :safety_contacts, :heir, :boolean, null: false, default: false
    add_column :fellows, :deceased_at, :datetime

    create_table :inheritance_claims do |t|
      t.references :fellow, null: false, foreign_key: true
      t.references :safety_contact, null: false, foreign_key: true # the heir who reported it
      t.references :heir_user, foreign_key: { to_table: :users }     # their Sondage account, made on confirmation
      t.string :status, null: false, default: "reported"            # reported | confirmed | refused | complete
      t.references :decided_by, foreign_key: { to_table: :users }
      t.datetime :decided_at
      t.datetime :release_after # earliest moment Sondage may release its copy to the heir
      t.text :note
      t.timestamps
    end
    add_reference :recoveries, :inheritance_claim, foreign_key: true

    # ---- Interviews in parts: each part is its own sealed recording.
    add_column :meetings, :part, :integer
    reversible do |dir|
      dir.up do
        # Number existing interviews 1, 2, 3… per Fellow, oldest first.
        rows = select_rows("SELECT id, fellow_id FROM meetings WHERE kind = 'interview' ORDER BY fellow_id, COALESCE(scheduled_at, created_at), id")
        rows.group_by(&:last).each_value { |list| list.each_with_index { |(id, _), i| execute("UPDATE meetings SET part = #{i + 1} WHERE id = #{id.to_i}") } }
      end
    end
  end
end
