# Four safety copies of each Fellow's key: one for the Fellow, two for family,
# one for Sondage. Any two rebuild the key; none alone reveals anything.
# Sondage stores its own piece (encrypted at rest) and, for everyone else, only a
# fingerprint of their piece so an approval can be matched without seeing it.
class CreateSafetyCopies < ActiveRecord::Migration[8.0]
  def change
    add_column :fellows, :sondage_share, :text

    create_table :safety_contacts do |t|
      t.references :fellow, null: false, foreign_key: true
      t.string :name, null: false
      t.string :email, null: false
      t.string :role, null: false, default: "family" # self | family
      t.string :piece_sha256, null: false
      t.timestamps
      t.index :piece_sha256, unique: true
    end

    create_table :recoveries do |t|
      t.references :fellow, null: false, foreign_key: true
      t.string :recipient, null: false # a one-time key made by the new computer; pieces are encrypted to it
      t.string :status, null: false, default: "pending" # pending | complete | cancelled | blocked
      t.datetime :release_after, null: false # earliest moment Sondage may release its piece
      t.datetime :sondage_released_at
      t.references :released_by, foreign_key: { to_table: :users }
      t.references :blocked_by, foreign_key: { to_table: :safety_contacts }
      t.datetime :completed_at
      t.string :client
      t.timestamps
    end

    create_table :recovery_approvals do |t|
      t.references :recovery, null: false, foreign_key: true
      t.references :safety_contact, null: false, foreign_key: true
      t.text :encrypted_piece, null: false # readable only by the new computer
      t.timestamps
      t.index [ :recovery_id, :safety_contact_id ], unique: true
    end
  end
end
