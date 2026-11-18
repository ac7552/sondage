# The Season details Sondage enters at setup. They name every file a Sitting
# produces: {convocation_year}-{surname}-{given_name}, e.g. 2027-alvarez-maria.
class AddSeasonToFellows < ActiveRecord::Migration[8.0]
  def change
    add_column :fellows, :given_name, :string
    add_column :fellows, :surname, :string
    add_column :fellows, :convocation_year, :integer
  end
end
