# Sign-in moves to Devise: email password resets, lockout after repeated guesses.
# Existing bcrypt password hashes stay valid.
class SwitchToDevise < ActiveRecord::Migration[8.0]
  def change
    rename_column :users, :email_address, :email
    rename_column :users, :password_digest, :encrypted_password
    change_column_default :users, :encrypted_password, from: nil, to: ""

    add_column :users, :reset_password_token, :string
    add_column :users, :reset_password_sent_at, :datetime
    add_column :users, :remember_created_at, :datetime
    add_column :users, :failed_attempts, :integer, default: 0, null: false
    add_column :users, :unlock_token, :string
    add_column :users, :locked_at, :datetime
    add_index :users, :reset_password_token, unique: true
    add_index :users, :unlock_token, unique: true

    drop_table :sessions do |t|
      t.references :user, null: false, foreign_key: true
      t.string :ip_address
      t.string :user_agent
      t.timestamps
    end
  end
end
