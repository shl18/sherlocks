#include <iostream>
#define PI 3.14159

using namespace std;

class Circle {
private:
    float radius;
    float area;

public:
    void acceptRadius() {
        cout << "Enter the radius of the circle: ";
        cin >> radius;
    }


    void calculateArea() {
        area = PI * radius * radius;
    }

    void displayArea() {
        cout << "The area of the circle is: " << area;
    }
};

int main() {
    Circle c;               
    c.acceptRadius();       
    c.calculateArea();      
    c.displayArea();        

    return 0;
}
